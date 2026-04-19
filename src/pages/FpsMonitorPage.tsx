import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeviceStore } from "../store/deviceStore";
import { startFpsMonitor, stopFpsMonitor, getFpsData, getBatteryInfo } from "../api/adb";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { FpsRecord } from "../types";

interface FpsSession {
  id: string;
  timestamp: number;
  durationSec: number;
  avgFps: number;
  maxFps: number;
  minFps: number;
  batteryDrain: number;  // 耗电量 %
  apps: string[];        // 期间运行的应用
  data: FpsRecord[];
}

const STORAGE_KEY = "fps_monitor_history";

function loadHistory(): FpsSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(sessions: FpsSession[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // ignore
  }
}

const FpsMonitorPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentDevice } = useDeviceStore();

  const [isRunning, setIsRunning] = useState(false);
  const [fpsData, setFpsData] = useState<FpsRecord[]>([]);
  const [history, setHistory] = useState<FpsSession[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      console.log("[fps] localStorage raw:", raw ? `${raw.length} chars` : "null");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      console.log("[fps] localStorage parsed:", Array.isArray(parsed) ? `${parsed.length} items` : typeof parsed);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((s: any) => ({
        id: s.id || String(Date.now()),
        timestamp: s.timestamp || Date.now(),
        durationSec: s.durationSec || 0,
        avgFps: s.avgFps || 0,
        maxFps: s.maxFps || 0,
        minFps: s.minFps || 0,
        batteryDrain: s.batteryDrain || 0,
        apps: Array.isArray(s.apps) ? s.apps : (s.packageName ? [s.packageName] : []),
        data: Array.isArray(s.data) ? s.data : [],
      }));
    } catch (e) {
      console.error("[fps] localStorage parse error:", e);
      return [];
    }
  });
  const [startBattery, setStartBattery] = useState<number | null>(null);
  const [endBattery, setEndBattery] = useState<number | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animFrameRef = useRef<number>(0);

  // Calculate stats (only non-zero fps)
  const safeFpsData = Array.isArray(fpsData) ? fpsData : [];
  const validFps = safeFpsData.filter((d) => d && d.fps > 0);
  const maxFps = validFps.length > 0 ? Math.round(Math.max(...validFps.map((d) => d.fps))) : 0;
  const minFps = validFps.length > 0 ? Math.round(Math.min(...validFps.map((d) => d.fps))) : 0;
  const avgFps = validFps.length > 0
    ? Math.round(validFps.reduce((sum, d) => sum + d.fps, 0) / validFps.length)
    : 0;
  const durationSec = safeFpsData.length > 0
    ? Math.round((safeFpsData[safeFpsData.length - 1].timestamp - safeFpsData[0].timestamp) / 1000)
    : 0;
  const batteryDrain = startBattery !== null && endBattery !== null ? startBattery - endBattery : null;

  // Get unique apps during monitoring
  const apps = [...new Set(safeFpsData.map((d) => d && d.foreground_app).filter(Boolean))];

  // Find app switch points (where foreground_app changes)
  const appSwitches: { timestamp: number; app: string }[] = [];
  for (let i = 1; i < safeFpsData.length; i++) {
    if (safeFpsData[i].foreground_app && safeFpsData[i].foreground_app !== safeFpsData[i - 1].foreground_app) {
      appSwitches.push({ timestamp: safeFpsData[i].timestamp, app: safeFpsData[i].foreground_app });
    }
  }

  // Draw FPS curve on canvas
  const drawCurve = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const data = Array.isArray(fpsData) ? fpsData : [];
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const padding = { top: 20, right: 20, bottom: 30, left: 45 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    // Clear
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1;
    const ySteps = [0, 30, 60, 90, 120];
    ySteps.forEach((val) => {
      const y = padding.top + chartH - (val / 120) * chartH;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartW, y);
      ctx.stroke();

      ctx.fillStyle = "#64748b";
      ctx.font = "11px monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${val}`, padding.left - 8, y + 4);
    });

    // X axis labels
    if (data.length > 1) {
      const startTime = data[0].timestamp;
      const endTime = data[data.length - 1].timestamp;
      const duration = Math.max(endTime - startTime, 1);
      const xSteps = Math.min(6, Math.ceil(duration / 5000));
      for (let i = 0; i <= xSteps; i++) {
        const timeOffset = (duration / xSteps) * i;
        const x = padding.left + (timeOffset / duration) * chartW;
        ctx.fillStyle = "#64748b";
        ctx.font = "11px monospace";
        ctx.textAlign = "center";
        ctx.fillText(`${(timeOffset / 1000).toFixed(0)}s`, x, h - 8);
      }
    }

    // 60 FPS reference line
    const y60 = padding.top + chartH - (60 / 120) * chartH;
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(padding.left, y60);
    ctx.lineTo(padding.left + chartW, y60);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ef4444";
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    ctx.fillText("60fps", padding.left + chartW - 40, y60 - 4);

    if (data.length > 1) {
      const startTime = data[0].timestamp;
      const endTime = data[data.length - 1].timestamp;
      const duration = Math.max(endTime - startTime, 1);

      // Fill area under curve
      ctx.beginPath();
      ctx.moveTo(padding.left, padding.top + chartH);
      data.forEach((d) => {
        const x = padding.left + ((d.timestamp - startTime) / duration) * chartW;
        const y = padding.top + chartH - (Math.min(d.fps, 120) / 120) * chartH;
        ctx.lineTo(x, y);
      });
      ctx.lineTo(padding.left + ((data[data.length - 1].timestamp - startTime) / duration) * chartW, padding.top + chartH);
      ctx.closePath();
      ctx.fillStyle = "rgba(34, 197, 94, 0.1)";
      ctx.fill();

      // Draw line
      ctx.beginPath();
      data.forEach((d, i) => {
        const x = padding.left + ((d.timestamp - startTime) / duration) * chartW;
        const y = padding.top + chartH - (Math.min(d.fps, 120) / 120) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw app switch markers
      appSwitches.forEach((sw) => {
        const x = padding.left + ((sw.timestamp - startTime) / duration) * chartW;
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, padding.top);
        ctx.lineTo(x, padding.top + chartH);
        ctx.stroke();
        ctx.setLineDash([]);

        // App name label (shortened)
        const shortName = sw.app.split(".").pop() || sw.app;
        ctx.fillStyle = "#f59e0b";
        ctx.font = "9px monospace";
        ctx.textAlign = "center";
        ctx.save();
        ctx.translate(x + 2, padding.top + 10);
        ctx.rotate(-Math.PI / 4);
        ctx.fillText(shortName, 0, 0);
        ctx.restore();
      });
    }
  }, [fpsData, appSwitches]);

  // Animation loop
  useEffect(() => {
    if (safeFpsData.length > 0) {
      const animate = () => {
        drawCurve();
        animFrameRef.current = requestAnimationFrame(animate);
      };
      animFrameRef.current = requestAnimationFrame(animate);
      return () => cancelAnimationFrame(animFrameRef.current);
    } else {
      drawCurve();
    }
  }, [fpsData, drawCurve]);

  // Start monitoring
  const startPolling = useCallback(async () => {
    if (!currentDevice) return;
    try {
      // Record start battery
      try {
        const bat: any = await getBatteryInfo(currentDevice);
        setStartBattery(bat.level ?? null);
        setEndBattery(null);
      } catch {}

      await startFpsMonitor(currentDevice);
      setIsRunning(true);
      setFpsData([]);

      pollRef.current = setInterval(async () => {
        try {
          const data = await getFpsData(currentDevice);
          setFpsData(Array.isArray(data) ? data : []);
        } catch {
          // ignore
        }
      }, 1000);
    } catch {
      // ignore
    }
  }, [currentDevice]);

  // Stop monitoring
  const stopPolling = useCallback(async () => {
    if (!currentDevice) return;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    try {
      await stopFpsMonitor(currentDevice);
    } catch {
      // ignore
    }
    setIsRunning(false);

    // Record end battery
    try {
      const bat: any = await getBatteryInfo(currentDevice);
      setEndBattery(bat.level ?? null);
    } catch {}

    // Save session to history
    if (safeFpsData.length > 0) {
      const valid = safeFpsData.filter((d) => d.fps > 0);
      const session: FpsSession = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        durationSec,
        avgFps: valid.length > 0 ? Math.round(valid.reduce((s, d) => s + d.fps, 0) / valid.length) : 0,
        maxFps: valid.length > 0 ? Math.round(Math.max(...valid.map((d) => d.fps))) : 0,
        minFps: valid.length > 0 ? Math.round(Math.min(...valid.map((d) => d.fps))) : 0,
        batteryDrain: batteryDrain ?? 0,
        apps: [...new Set(safeFpsData.map((d) => d.foreground_app).filter(Boolean))],
        data: [...safeFpsData],
      };
      const newHistory = [session, ...history].slice(0, 20);
      setHistory(newHistory);
      saveHistory(newHistory);
    }
  }, [currentDevice, fpsData, history, durationSec, batteryDrain]);

  // Cleanup：切换页面时自动停止后端监控
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      cancelAnimationFrame(animFrameRef.current);
      // 切换页面时停止后端 FPS 监控任务
      if (currentDevice) {
        stopFpsMonitor(currentDevice).catch(() => {});
      }
    };
  }, [currentDevice]);

  // Export as PNG
  const handleExport = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || safeFpsData.length === 0) return;

    try {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const statsHeight = 100;

      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = w * dpr;
      exportCanvas.height = (h + statsHeight) * dpr;
      const ctx = exportCanvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);

      // 绘制帧率曲线
      ctx.drawImage(canvas, 0, 0, w, h);

      // Stats overlay
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, h, w, statsHeight);

      ctx.font = "12px monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = "#22c55e";
      ctx.fillText(`Avg: ${avgFps} fps`, 20, h + 20);
      ctx.fillStyle = "#3b82f6";
      ctx.fillText(`Max: ${maxFps} fps`, 20, h + 38);
      ctx.fillStyle = "#ef4444";
      ctx.fillText(`Min: ${minFps} fps`, 20, h + 56);
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(`Duration: ${durationSec}s`, 200, h + 20);
      if (batteryDrain !== null && batteryDrain > 0) {
        ctx.fillText(`Battery: -${batteryDrain}%`, 200, h + 38);
      }
      ctx.fillText(`Device: ${currentDevice}`, 200, h + 56);

      // 转换为 blob
      const blob = await new Promise<Blob | null>((resolve) =>
        exportCanvas.toBlob(resolve, "image/png")
      );
      if (!blob) return;

      // 用 Tauri save dialog
      const filePath = await save({
        defaultPath: `fps-${currentDevice}-${Date.now()}.png`,
        filters: [{ name: "PNG", extensions: ["png"] }],
      });
      if (!filePath) return;

      const buffer = await blob.arrayBuffer();
      await writeFile(filePath, new Uint8Array(buffer));
    } catch (e) {
      console.error("[fps] Export error:", e);
    }
  }, [safeFpsData, maxFps, minFps, avgFps, durationSec, batteryDrain, currentDevice]);

  // Load history session
  const loadSession = useCallback((session: FpsSession) => {
    setFpsData(session.data);
    setStartBattery(null);
    setEndBattery(null);
    setIsRunning(false);
  }, []);

  if (!currentDevice) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-dark-400">{t("device.noDevice")}</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto animate-fade-in">
      <h1 className="text-xl font-semibold text-dark-100 mb-6">{t("nav.fpsMonitor")}</h1>

      {/* Controls */}
      <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6 mb-6">
        <div className="flex items-center gap-3">
          {!isRunning ? (
            <button
              onClick={startPolling}
              className="px-4 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors text-sm font-medium"
            >
              {t("fps.start")}
            </button>
          ) : (
            <button
              onClick={stopPolling}
              className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors text-sm font-medium"
            >
              {t("fps.stop")}
            </button>
          )}
          <button
            onClick={handleExport}
            disabled={safeFpsData.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 disabled:opacity-50 transition-colors text-sm"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {t("fps.exportImage")}
          </button>
          {isRunning && (
            <span className="flex items-center gap-2 text-xs text-dark-400">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Monitoring...
            </span>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6 mb-6">
        <canvas
          ref={canvasRef}
          className="w-full rounded-lg"
          style={{ height: "300px" }}
        />
        {safeFpsData.length === 0 && !isRunning && (
          <p className="text-center text-dark-500 text-sm mt-4">{t("fps.noData")}</p>
        )}
      </div>

      {/* Stats */}
      {safeFpsData.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-4 text-center">
            <span className="text-xs text-dark-500">{t("fps.avgFps")}</span>
            <p className="text-2xl font-bold text-blue-400 mt-1">{avgFps}</p>
          </div>
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-4 text-center">
            <span className="text-xs text-dark-500">{t("fps.maxFps")}</span>
            <p className="text-2xl font-bold text-green-400 mt-1">{maxFps}</p>
          </div>
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-4 text-center">
            <span className="text-xs text-dark-500">{t("fps.minFps")}</span>
            <p className="text-2xl font-bold text-red-400 mt-1">{minFps}</p>
          </div>
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-4 text-center">
            <span className="text-xs text-dark-500">Duration</span>
            <p className="text-2xl font-bold text-dark-200 mt-1">{durationSec}s</p>
          </div>
        </div>
      )}

      {/* Battery & Apps */}
      {safeFpsData.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {batteryDrain !== null && batteryDrain > 0 && (
            <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-4">
              <span className="text-xs text-dark-500">Battery Drain</span>
              <p className="text-lg font-bold text-yellow-400 mt-1">-{batteryDrain}%</p>
              <p className="text-xs text-dark-500 mt-1">{startBattery}% → {endBattery}%</p>
            </div>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-dark-300 mb-4">{t("fps.history")}</h3>
          <div className="space-y-2">
            {history.map((session) => (
              <button
                key={session.id}
                onClick={() => loadSession(session)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-lg bg-dark-700/30 hover:bg-dark-700/60 transition-colors text-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="text-dark-200 font-medium">{session.avgFps} avg fps</span>
                  <span className="text-dark-500">{session.durationSec}s</span>
                  {session.batteryDrain > 0 && (
                    <span className="text-yellow-400">-{session.batteryDrain}%</span>
                  )}
                  {session.apps.length > 0 && (
                    <span className="text-dark-500 truncate max-w-[200px]">
                      {session.apps.map(a => a.split(".").pop()).join(", ")}
                    </span>
                  )}
                </div>
                <span className="text-dark-500 text-xs">
                  {new Date(session.timestamp).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default FpsMonitorPage;

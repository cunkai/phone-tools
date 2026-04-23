import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAutomationStore } from "../store/automationStore";
import type { ActionBlock } from "../types/automation";

interface InsertDataDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (blockId: string, property: string, variableName: string, sourceType: "params" | "result") => void;
  blocks: ActionBlock[];
  currentBlockIndex: number;
}

const InsertDataDialog: React.FC<InsertDataDialogProps> = ({ isOpen, onClose, onInsert, blocks, currentBlockIndex }) => {
  const { t } = useTranslation();
  const blockResults = useAutomationStore((s) => s.blockResults);
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [selectedProperty, setSelectedProperty] = useState("");
  const [variableName, setVariableName] = useState("");
  const [sourceType, setSourceType] = useState<"params" | "result">("params");
  const [availableProperties, setAvailableProperties] = useState<Array<{ name: string; path: string }>>([]);

  // 过滤当前块之前的块
  const previousBlocks = useMemo(() => blocks.slice(0, currentBlockIndex), [blocks, currentBlockIndex]);

  // 重置状态
  const resetState = useCallback(() => {
    setSelectedBlockId("");
    setSelectedProperty("");
    setVariableName("");
    setSourceType("params");
    setAvailableProperties([]);
  }, []);

  // 当对话框打开时重置状态
  useEffect(() => {
    if (isOpen) {
      resetState();
    }
  }, [isOpen, resetState]);

  // 当选择的块或源类型改变时，更新可用的属性
  useEffect(() => {
    if (!selectedBlockId) {
      setAvailableProperties([]);
      setSelectedProperty("");
      return;
    }

    const properties: Array<{ name: string; path: string }> = [];

    if (sourceType === "result") {
      // 选择块的执行结果
      const blockResult = blockResults[selectedBlockId];
      if (blockResult) {
        properties.push({ name: "执行结果", path: "result" });
        if (blockResult.result.message) {
          properties.push({ name: "结果消息", path: "result.message" });
        }
        if (blockResult.result.success !== undefined) {
          properties.push({ name: "是否成功", path: "result.success" });
        }
        if (blockResult.result.returnValue !== null && blockResult.result.returnValue !== undefined) {
          properties.push({ name: "返回值", path: "result.returnValue" });
        }
        if (blockResult.result.matched !== undefined) {
          properties.push({ name: "是否匹配", path: "result.matched" });
        }
      }
      // 始终提供"执行结果"选项
      if (properties.length === 0) {
        properties.push({ name: "执行结果", path: "result" });
      }
    } else {
      // 选择块的参数（原有逻辑）
      const block = previousBlocks.find((b) => b.id === selectedBlockId);
      if (!block) {
        setAvailableProperties([]);
        setSelectedProperty("");
        return;
      }

      // 根据块类型生成可用的属性路径
      switch (block.type) {
        case "tap":
        case "double_tap":
          properties.push(
            { name: "X 坐标", path: "tap.x" },
            { name: "Y 坐标", path: "tap.y" }
          );
          break;
        case "long_press":
          properties.push(
            { name: "X 坐标", path: "long_press.x" },
            { name: "Y 坐标", path: "long_press.y" },
            { name: "持续时间", path: "long_press.duration" }
          );
          break;
        case "swipe":
        case "drag":
          properties.push(
            { name: "起始 X 坐标", path: "swipe.from.x" },
            { name: "起始 Y 坐标", path: "swipe.from.y" },
            { name: "结束 X 坐标", path: "swipe.to.x" },
            { name: "结束 Y 坐标", path: "swipe.to.y" },
            { name: "持续时间", path: "swipe.duration" }
          );
          break;
        case "keyevent":
          properties.push(
            { name: "按键码", path: "keyevent.code" },
            { name: "动作", path: "keyevent.action" },
            { name: "文本输入", path: "keyevent.textInput" }
          );
          break;
        case "text":
          properties.push(
            { name: "文本内容", path: "text.content" }
          );
          break;
        case "open_url":
          properties.push(
            { name: "URL", path: "open_url.url" }
          );
          break;
        case "shell":
          properties.push(
            { name: "命令", path: "shell.command" }
          );
          break;
        case "open_app":
          properties.push(
            { name: "包名", path: "open_app.package" }
          );
          break;
        case "delay":
          properties.push(
            { name: "延迟时间", path: "delay.ms" }
          );
          break;
        case "condition":
          properties.push(
            { name: "目标 X 坐标", path: "condition.target.x" },
            { name: "目标 Y 坐标", path: "condition.target.y" },
            { name: "期望颜色 R", path: "condition.expected.r" },
            { name: "期望颜色 G", path: "condition.expected.g" },
            { name: "期望颜色 B", path: "condition.expected.b" },
            { name: "期望颜色 A", path: "condition.expected.a" },
            { name: "容差", path: "condition.tolerance" },
            { name: "超时时间", path: "condition.timeout" }
          );
          break;
        case "code":
          properties.push(
            { name: "代码内容", path: "code.content" }
          );
          break;
      }
    }

    setAvailableProperties(properties);
    setSelectedProperty(properties[0]?.path || "");
  }, [selectedBlockId, previousBlocks, sourceType, blockResults]);

  // 自动生成变量名
  useEffect(() => {
    if (selectedBlockId && selectedProperty) {
      const block = previousBlocks.find((b) => b.id === selectedBlockId);
      if (block) {
        const blockType = block.type;
        const propertyName = selectedProperty.split(".").pop();
        if (propertyName) {
          const prefix = sourceType === "result" ? "result" : "data";
          const generatedName = `${prefix}_${blockType}_${propertyName}`;
          setVariableName(generatedName);
        }
      }
    }
  }, [selectedBlockId, selectedProperty, previousBlocks, sourceType]);

  const handleInsert = useCallback(() => {
    if (selectedBlockId && selectedProperty && variableName) {
      onInsert(selectedBlockId, selectedProperty, variableName, sourceType);
      onClose();
    }
  }, [selectedBlockId, selectedProperty, variableName, sourceType, onInsert, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-dark-900 border border-dark-700 rounded-xl shadow-2xl w-full max-w-md p-4">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-dark-100">{t("automation.insertData")}</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-dark-700 rounded transition-colors text-dark-400"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="4" x2="16" y2="16" />
              <line x1="16" y1="4" x2="4" y2="16" />
            </svg>
          </button>
        </div>

        {/* 选择源类型 */}
        <div className="mb-4">
          <label className="text-xs text-dark-400 mb-1 block">数据来源</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setSourceType("params")}
              className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                sourceType === "params"
                  ? "bg-accent-500/20 text-accent-400 border border-accent-500/30"
                  : "bg-dark-700 text-dark-200 border border-dark-600 hover:bg-dark-600"
              }`}
            >
              块参数
            </button>
            <button
              onClick={() => setSourceType("result")}
              className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                sourceType === "result"
                  ? "bg-accent-500/20 text-accent-400 border border-accent-500/30"
                  : "bg-dark-700 text-dark-200 border border-dark-600 hover:bg-dark-600"
              }`}
            >
              执行结果
            </button>
          </div>
        </div>

        {/* 选择块 */}
        <div className="mb-4">
          <label className="text-xs text-dark-400 mb-1 block">{t("automation.selectBlock")}</label>
          <select
            value={selectedBlockId}
            onChange={(e) => setSelectedBlockId(e.target.value)}
            className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-sm text-dark-200 focus:outline-none focus:border-accent-500"
          >
            <option value="">{t("automation.selectBlockPlaceholder")}</option>
            {previousBlocks.map((block, index) => (
              <option key={block.id} value={block.id}>
                {index + 1}. {block.label || block.type}
                {blockResults[block.id] && " (有结果)"}
              </option>
            ))}
          </select>
        </div>

        {/* 选择属性 */}
        <div className="mb-4">
          <label className="text-xs text-dark-400 mb-1 block">{t("automation.selectProperty")}</label>
          <select
            value={selectedProperty}
            onChange={(e) => setSelectedProperty(e.target.value)}
            disabled={!selectedBlockId}
            className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-sm text-dark-200 focus:outline-none focus:border-accent-500 disabled:opacity-50"
          >
            <option value="">{t("automation.selectPropertyPlaceholder")}</option>
            {availableProperties.map((prop) => (
              <option key={prop.path} value={prop.path}>
                {prop.name}
              </option>
            ))}
          </select>
        </div>

        {/* 变量名 */}
        <div className="mb-4">
          <label className="text-xs text-dark-400 mb-1 block">{t("automation.variableName")}</label>
          <input
            type="text"
            value={variableName}
            onChange={(e) => setVariableName(e.target.value)}
            disabled={!selectedProperty}
            className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-sm text-dark-200 focus:outline-none focus:border-accent-500 disabled:opacity-50"
            placeholder={t("automation.variableNamePlaceholder")}
          />
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-sm"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleInsert}
            disabled={!selectedBlockId || !selectedProperty || !variableName}
            className="flex-1 px-4 py-2 rounded-lg bg-accent-500/20 text-accent-400 hover:bg-accent-500/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
          >
            {t("common.insert")}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InsertDataDialog;
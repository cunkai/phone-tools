import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface InstallProgressEvent {
  progress: number;
  message: string;
}

export interface DeviceEvent {
  serial: string;
}

export interface LogOutputEvent {
  line: string;
}

export interface ShellOutputEvent {
  output: string;
  isError: boolean;
}

export async function onInstallProgress(
  handler: (event: InstallProgressEvent) => void
): Promise<UnlistenFn> {
  return listen<InstallProgressEvent>("install-progress", (event) => {
    handler(event.payload);
  });
}

export async function onDeviceConnected(
  handler: (event: DeviceEvent) => void
): Promise<UnlistenFn> {
  return listen<DeviceEvent>("device-connected", (event) => {
    handler(event.payload);
  });
}

export async function onDeviceDisconnected(
  handler: (event: DeviceEvent) => void
): Promise<UnlistenFn> {
  return listen<DeviceEvent>("device-disconnected", (event) => {
    handler(event.payload);
  });
}

export async function onLogOutput(
  handler: (event: LogOutputEvent) => void
): Promise<UnlistenFn> {
  return listen<LogOutputEvent>("log-output", (event) => {
    handler(event.payload);
  });
}

export async function onShellOutput(
  handler: (event: ShellOutputEvent) => void
): Promise<UnlistenFn> {
  return listen<ShellOutputEvent>("shell-output", (event) => {
    handler(event.payload);
  });
}

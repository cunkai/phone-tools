import { invoke } from "@tauri-apps/api/core";
import type { BackendAction, ActionResult } from "../types/automation";

export async function executeAction(
  serial: string,
  platform: string,
  action: BackendAction,
): Promise<ActionResult> {
  return invoke<ActionResult>("execute_action", { serial, platform, action });
}

export async function stopAutomation(): Promise<void> {
  return invoke<void>("stop_automation");
}

export async function resetAutomation(): Promise<void> {
  return invoke<void>("reset_automation");
}

const CODING_MODE_KEY = 'astrachat_coding_mode';
const PLAN_MODE_KEY = 'astrachat_coding_plan_mode';

function chatKey(base: string, chatId: string | null | undefined): string {
  return chatId ? `${base}:${chatId}` : base;
}

export function isCodingModeEnabled(chatId?: string | null): boolean {
  try {
    return localStorage.getItem(chatKey(CODING_MODE_KEY, chatId)) === 'true';
  } catch {
    return false;
  }
}

export function setCodingModeEnabled(chatId: string | null | undefined, enabled: boolean): void {
  try {
    localStorage.setItem(chatKey(CODING_MODE_KEY, chatId), enabled ? 'true' : 'false');
  } catch {}
}

export function isCodingPlanModeEnabled(chatId?: string | null): boolean {
  try {
    return localStorage.getItem(chatKey(PLAN_MODE_KEY, chatId)) === 'true';
  } catch {
    return false;
  }
}

export function setCodingPlanModeEnabled(chatId: string | null | undefined, enabled: boolean): void {
  try {
    localStorage.setItem(chatKey(PLAN_MODE_KEY, chatId), enabled ? 'true' : 'false');
  } catch {}
}

/** Включить Coding при открытии панели шестерёнки (чтобы не забыть переключатель). */
export function enableCodingFromGearPanel(chatId: string | null | undefined): void {
  setCodingModeEnabled(chatId, true);
  window.dispatchEvent(new CustomEvent('astrachatCodingSelectionChanged'));
}

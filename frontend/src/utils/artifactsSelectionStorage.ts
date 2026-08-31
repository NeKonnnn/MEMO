/** Per-chat режим артефактов в «Инструменты → Артефакты» (только shadcn / свой промпт). */

import { readAgentArtifactsDefaults, type ArtifactsSettings } from './agentArtifactsEnabled';

export type ChatArtifactsSettings = ArtifactsSettings;

/** Состояние панели инструментов (без тумблера «Включить артефакты»). */
export type ChatArtifactsToolsState = Pick<ChatArtifactsSettings, 'shadcn_enabled' | 'user_prompt_mode'>;

export const ARTIFACTS_SELECTION_CHANGED_EVENT = 'astrachatArtifactsSelectionChanged';

function storageKey(chatId: string): string {
  return `chat:${chatId}:artifacts_settings`;
}

function readStored(chatId: string): Partial<ChatArtifactsToolsState> | null {
  try {
    const raw = localStorage.getItem(storageKey(chatId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<ChatArtifactsToolsState & { artifacts_enabled?: boolean }>;
    if (!parsed || typeof parsed !== 'object') return null;
    const { shadcn_enabled, user_prompt_mode } = parsed;
    return {
      ...(shadcn_enabled !== undefined ? { shadcn_enabled: Boolean(shadcn_enabled) } : {}),
      ...(user_prompt_mode !== undefined ? { user_prompt_mode: Boolean(user_prompt_mode) } : {}),
    };
  } catch {
    return null;
  }
}

/** Взаимоисключение shadcn ↔ пользовательский промпт. */
export function normalizeArtifactsToolsState(
  state: Partial<ChatArtifactsToolsState>,
): ChatArtifactsToolsState {
  const shadcn = Boolean(state.shadcn_enabled);
  const userPrompt = Boolean(state.user_prompt_mode);
  if (shadcn && userPrompt) {
    return { shadcn_enabled: true, user_prompt_mode: false };
  }
  return { shadcn_enabled: shadcn, user_prompt_mode: userPrompt };
}

/** Для UI «Инструменты → Артефакты»: дефолты агента + override чата. */
export function getChatArtifactsToolsState(chatId?: string | null): ChatArtifactsToolsState {
  const agent = readAgentArtifactsDefaults();
  if (!chatId) {
    return normalizeArtifactsToolsState({
      shadcn_enabled: agent.shadcn_enabled,
      user_prompt_mode: agent.user_prompt_mode,
    });
  }
  const stored = readStored(chatId);
  if (!stored) {
    return normalizeArtifactsToolsState({
      shadcn_enabled: agent.shadcn_enabled,
      user_prompt_mode: agent.user_prompt_mode,
    });
  }
  return normalizeArtifactsToolsState({
    shadcn_enabled: stored.shadcn_enabled ?? agent.shadcn_enabled,
    user_prompt_mode: stored.user_prompt_mode ?? agent.user_prompt_mode,
  });
}

export function isChatArtifactsToolsActive(state: ChatArtifactsToolsState): boolean {
  return state.shadcn_enabled || state.user_prompt_mode;
}

/**
 * Эффективные настройки для сокета / viewer:
 * artifacts_enabled — из агента ИЛИ если в инструментах включён shadcn/свой промпт.
 */
export function getEffectiveArtifactsSettings(chatId?: string | null): ChatArtifactsSettings {
  const agent = readAgentArtifactsDefaults();
  const tools = getChatArtifactsToolsState(chatId);
  const toolsActive = isChatArtifactsToolsActive(tools);
  return {
    artifacts_enabled: Boolean(agent.artifacts_enabled || toolsActive),
    shadcn_enabled: tools.shadcn_enabled,
    user_prompt_mode: tools.user_prompt_mode,
  };
}

/** @deprecated Используйте getEffectiveArtifactsSettings / getChatArtifactsToolsState. */
export function getArtifactsSettingsForChat(chatId?: string | null): ChatArtifactsSettings {
  return getEffectiveArtifactsSettings(chatId);
}

export function hasChatArtifactsOverride(chatId?: string | null): boolean {
  if (!chatId) return false;
  try {
    return localStorage.getItem(storageKey(chatId)) !== null;
  } catch {
    return false;
  }
}

function writeToolsState(chatId: string, state: ChatArtifactsToolsState): void {
  localStorage.setItem(storageKey(chatId), JSON.stringify(normalizeArtifactsToolsState(state)));
  window.dispatchEvent(
    new CustomEvent(ARTIFACTS_SELECTION_CHANGED_EVENT, { detail: { chatId } }),
  );
}

/** Переключить режим в «Инструменты → Артефакты» (взаимоисключение). */
export function setChatArtifactsToolMode(
  chatId: string,
  key: 'shadcn_enabled' | 'user_prompt_mode',
  checked: boolean,
): ChatArtifactsToolsState {
  const current = getChatArtifactsToolsState(chatId);
  let next: ChatArtifactsToolsState;
  if (checked) {
    next =
      key === 'shadcn_enabled'
        ? { shadcn_enabled: true, user_prompt_mode: false }
        : { shadcn_enabled: false, user_prompt_mode: true };
  } else {
    next = normalizeArtifactsToolsState({ ...current, [key]: false });
  }
  writeToolsState(chatId, next);
  return next;
}

export function clearArtifactsSettingsForChat(chatId: string): void {
  try {
    localStorage.removeItem(storageKey(chatId));
  } catch {
    /* */
  }
  window.dispatchEvent(
    new CustomEvent(ARTIFACTS_SELECTION_CHANGED_EVENT, { detail: { chatId } }),
  );
}

/** Выключить режимы артефактов для чата (явный override, даже если дефолт — из агента). */
export function disableChatArtifactsToolsForChat(chatId: string): ChatArtifactsToolsState {
  const next: ChatArtifactsToolsState = { shadcn_enabled: false, user_prompt_mode: false };
  writeToolsState(chatId, next);
  return next;
}

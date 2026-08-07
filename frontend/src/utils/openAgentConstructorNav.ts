import type { NavigateFunction } from 'react-router-dom';
import {
  ASTRA_OPEN_AGENT_CONSTRUCTOR,
  ASTRA_OPEN_AGENT_CONSTRUCTOR_ID_KEY,
} from '../constants/hotkeys';

export const OPEN_AGENT_CONSTRUCTOR_NAV_STATE_KEY = 'openAgentConstructorId';

/** Сохранить id агента для открытия в конструкторе после navigate. */
export function stashAgentConstructorOpen(agentId: number): void {
  try {
    sessionStorage.setItem(ASTRA_OPEN_AGENT_CONSTRUCTOR_ID_KEY, String(agentId));
  } catch {
    /* */
  }
}

/** Прочитать отложенный id без удаления (удаляет AgentConstructorPanel после выбора). */
export function peekPendingAgentConstructorId(): number | null {
  try {
    const raw = sessionStorage.getItem(ASTRA_OPEN_AGENT_CONSTRUCTOR_ID_KEY);
    if (!raw) return null;
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function resolvePendingAgentConstructorId(
  locationState: unknown,
): number | null {
  const state = locationState as { [OPEN_AGENT_CONSTRUCTOR_NAV_STATE_KEY]?: number } | null;
  const fromState = state?.[OPEN_AGENT_CONSTRUCTOR_NAV_STATE_KEY];
  if (typeof fromState === 'number' && Number.isFinite(fromState) && fromState > 0) {
    return fromState;
  }
  return peekPendingAgentConstructorId();
}

/** Открыть агента в конструкторе на главной (чат): navigate + надёжная доставка события. */
export function openAgentInConstructor(agentId: number, navigate: NavigateFunction): void {
  stashAgentConstructorOpen(agentId);
  navigate('/', {
    state: { [OPEN_AGENT_CONSTRUCTOR_NAV_STATE_KEY]: agentId },
  });
  // Сразу — если чат уже смонтирован; rAF — после mount при переходе с другой страницы.
  window.dispatchEvent(
    new CustomEvent(ASTRA_OPEN_AGENT_CONSTRUCTOR, { detail: { agentId } }),
  );
  window.requestAnimationFrame(() => {
    window.dispatchEvent(
      new CustomEvent(ASTRA_OPEN_AGENT_CONSTRUCTOR, { detail: { agentId } }),
    );
  });
}

import type { NavigateFunction } from 'react-router-dom';
import {
  ASTRA_OPEN_SKILLS_SIDEBAR,
  ASTRA_OPEN_SKILLS_SIDEBAR_ID_KEY,
} from '../constants/hotkeys';

export const OPEN_SKILL_SIDEBAR_NAV_STATE_KEY = 'openSkillSidebarId';

export function stashSkillSidebarOpen(skillId: number): void {
  try {
    sessionStorage.setItem(ASTRA_OPEN_SKILLS_SIDEBAR_ID_KEY, String(skillId));
  } catch {
    /* */
  }
}

export function peekPendingSkillSidebarId(): number | null {
  try {
    const raw = sessionStorage.getItem(ASTRA_OPEN_SKILLS_SIDEBAR_ID_KEY);
    if (!raw) return null;
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

export function resolvePendingSkillSidebarId(locationState: unknown): number | null {
  const state = locationState as { [OPEN_SKILL_SIDEBAR_NAV_STATE_KEY]?: number } | null;
  const fromState = state?.[OPEN_SKILL_SIDEBAR_NAV_STATE_KEY];
  if (typeof fromState === 'number' && Number.isFinite(fromState) && fromState > 0) {
    return fromState;
  }
  return peekPendingSkillSidebarId();
}

/** Открыть skill в правой панели Skills на главной (чат). */
export function openSkillInSidebar(skillId: number, navigate: NavigateFunction): void {
  stashSkillSidebarOpen(skillId);
  navigate('/', {
    state: { [OPEN_SKILL_SIDEBAR_NAV_STATE_KEY]: skillId },
  });
  window.dispatchEvent(
    new CustomEvent(ASTRA_OPEN_SKILLS_SIDEBAR, { detail: { skillId } }),
  );
  window.requestAnimationFrame(() => {
    window.dispatchEvent(
      new CustomEvent(ASTRA_OPEN_SKILLS_SIDEBAR, { detail: { skillId } }),
    );
  });
}

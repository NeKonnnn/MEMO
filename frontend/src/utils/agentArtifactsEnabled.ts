/** Флаги активного агента для ArtifactCard / presentation viewer в чате. */

import { skillImpliesPresentation } from './messageArtifactsViewerStorage';

export const AGENT_ARTIFACTS_ENABLED_KEY = 'active_agent_artifacts_enabled';
export const AGENT_SHADCN_ENABLED_KEY = 'active_agent_shadcn_enabled';
export const AGENT_USER_PROMPT_MODE_KEY = 'active_agent_user_prompt_mode';
/** У активного агента в skill_ids есть именно presentation skill (не mermaid/visual). */
export const AGENT_PRESENTATION_SKILLS_KEY = 'active_agent_presentation_skills_v2';
export const AGENT_ARTIFACTS_CHANGED_EVENT = 'astrachatAgentArtifactsChanged';

export interface ArtifactsSettings {
  artifacts_enabled: boolean;
  shadcn_enabled: boolean;
  user_prompt_mode: boolean;
}

function readAgentSkillIds(config: Record<string, unknown> | null | undefined): string[] {
  if (!config) return [];
  const raw = config.skill_ids;
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x || '').trim()).filter(Boolean);
}

export function readAgentArtifactsEnabled(): boolean {
  try {
    return localStorage.getItem(AGENT_ARTIFACTS_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function readAgentArtifactsDefaults(): ArtifactsSettings {
  try {
    return {
      artifacts_enabled: readAgentArtifactsEnabled(),
      shadcn_enabled: localStorage.getItem(AGENT_SHADCN_ENABLED_KEY) === '1',
      user_prompt_mode: localStorage.getItem(AGENT_USER_PROMPT_MODE_KEY) === '1',
    };
  } catch {
    return { artifacts_enabled: false, shadcn_enabled: false, user_prompt_mode: false };
  }
}

/** Агент с skill презентации — сразу ждать presentation viewer. */
export function readAgentPresentationSkills(): boolean {
  try {
    return localStorage.getItem(AGENT_PRESENTATION_SKILLS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Live-гейт viewer от карточки агента: artifacts_enabled ИЛИ presentation-like skill. */
export function readAgentViewerGate(): boolean {
  return readAgentArtifactsEnabled() || readAgentPresentationSkills();
}

/** Сохранить флаги из config агента (или сбросить при null). */
export function persistAgentArtifactsEnabled(
  config: Record<string, unknown> | null | undefined,
): void {
  try {
    const artifactsEnabled = Boolean(config && config.artifacts_enabled);
    const shadcnEnabled = Boolean(config && config.shadcn_enabled);
    const userPromptMode = Boolean(config && config.user_prompt_mode);
    const presentationSkills = readAgentSkillIds(config).some(skillImpliesPresentation);

    if (artifactsEnabled) {
      localStorage.setItem(AGENT_ARTIFACTS_ENABLED_KEY, '1');
    } else {
      localStorage.removeItem(AGENT_ARTIFACTS_ENABLED_KEY);
    }

    if (shadcnEnabled) {
      localStorage.setItem(AGENT_SHADCN_ENABLED_KEY, '1');
    } else {
      localStorage.removeItem(AGENT_SHADCN_ENABLED_KEY);
    }

    if (userPromptMode) {
      localStorage.setItem(AGENT_USER_PROMPT_MODE_KEY, '1');
    } else {
      localStorage.removeItem(AGENT_USER_PROMPT_MODE_KEY);
    }

    if (presentationSkills) {
      localStorage.setItem(AGENT_PRESENTATION_SKILLS_KEY, '1');
    } else {
      localStorage.removeItem(AGENT_PRESENTATION_SKILLS_KEY);
    }

    window.dispatchEvent(
      new CustomEvent(AGENT_ARTIFACTS_CHANGED_EVENT, {
        detail: { enabled: artifactsEnabled || presentationSkills, artifactsEnabled, presentationSkills },
      }),
    );
  } catch {
    /* */
  }
}

export function clearAgentArtifactsEnabled(): void {
  try {
    localStorage.removeItem(AGENT_ARTIFACTS_ENABLED_KEY);
    localStorage.removeItem(AGENT_SHADCN_ENABLED_KEY);
    localStorage.removeItem(AGENT_USER_PROMPT_MODE_KEY);
    localStorage.removeItem(AGENT_PRESENTATION_SKILLS_KEY);
  } catch {
    /* */
  }
  window.dispatchEvent(
    new CustomEvent(AGENT_ARTIFACTS_CHANGED_EVENT, {
      detail: { enabled: false, artifactsEnabled: false, presentationSkills: false },
    }),
  );
}

/** Достать config из detail события agentSelected. */
export function artifactsConfigFromAgentDetail(detail: unknown): Record<string, unknown> | null {
  if (!detail || typeof detail !== 'object') return null;
  const cfg = (detail as { config?: unknown }).config;
  if (!cfg || typeof cfg !== 'object') return null;
  return cfg as Record<string, unknown>;
}

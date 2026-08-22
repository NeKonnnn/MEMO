/** Флаги активного агента для ArtifactCard / presentation viewer в чате. */

import { skillImpliesArtifactsViewer } from './messageArtifactsViewerStorage';

export const AGENT_ARTIFACTS_ENABLED_KEY = 'active_agent_artifacts_enabled';
/** У активного агента в skill_ids есть presentation-like skill. */
export const AGENT_PRESENTATION_SKILLS_KEY = 'active_agent_presentation_skills';
export const AGENT_ARTIFACTS_CHANGED_EVENT = 'astrachatAgentArtifactsChanged';

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

/** Агент с skill презентации / визуалов — сразу ждать presentation viewer. */
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
    const presentationSkills = readAgentSkillIds(config).some(skillImpliesArtifactsViewer);

    if (artifactsEnabled) {
      localStorage.setItem(AGENT_ARTIFACTS_ENABLED_KEY, '1');
    } else {
      localStorage.removeItem(AGENT_ARTIFACTS_ENABLED_KEY);
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
  persistAgentArtifactsEnabled(null);
}

/** Достать config из detail события agentSelected. */
export function artifactsConfigFromAgentDetail(detail: unknown): Record<string, unknown> | null {
  if (!detail || typeof detail !== 'object') return null;
  const cfg = (detail as { config?: unknown }).config;
  if (!cfg || typeof cfg !== 'object') return null;
  return cfg as Record<string, unknown>;
}

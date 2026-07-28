/** Выбранные skills для чата (slugs) — как active_agent, но multi-select. */

export const SKILL_SELECTION_CHANGED_EVENT = 'astrachatSkillSelectionChanged';

const STORAGE_KEY = 'active_skill_ids';

export function getActiveSkillIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const x of parsed) {
      const id = String(x || '').trim();
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function setActiveSkillIds(ids: string[]): void {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const x of ids) {
    const id = String(x || '').trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      normalized.push(id);
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(
    new CustomEvent(SKILL_SELECTION_CHANGED_EVENT, { detail: { skillIds: normalized } }),
  );
}

export function isSkillActive(slug: string): boolean {
  const id = (slug || '').trim();
  return Boolean(id) && getActiveSkillIds().includes(id);
}

export function toggleActiveSkill(slug: string, enabled: boolean): string[] {
  const id = (slug || '').trim();
  if (!id) return getActiveSkillIds();
  const current = getActiveSkillIds();
  const next = enabled
    ? current.includes(id)
      ? current
      : [...current, id]
    : current.filter((x) => x !== id);
  setActiveSkillIds(next);
  return next;
}

export function clearActiveSkills(): void {
  setActiveSkillIds([]);
}

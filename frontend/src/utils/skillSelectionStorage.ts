/** Выбранные skills для чата (slugs) — как active_agent, но multi-select. */

export const SKILL_SELECTION_CHANGED_EVENT = 'astrachatSkillSelectionChanged';

const STORAGE_KEY = 'active_skill_ids';

export type ActiveSkillRef = {
  slug: string;
  name?: string;
};

function normalizeRefs(raw: unknown): ActiveSkillRef[] {
  if (!Array.isArray(raw)) return [];
  const out: ActiveSkillRef[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    let slug = '';
    let name: string | undefined;
    if (typeof x === 'string') {
      slug = x.trim();
    } else if (x && typeof x === 'object') {
      const obj = x as { slug?: unknown; id?: unknown; name?: unknown };
      slug = String(obj.slug || obj.id || '').trim();
      const n = String(obj.name || '').trim();
      if (n) name = n;
    }
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(name ? { slug, name } : { slug });
  }
  return out;
}

export function getActiveSkillRefs(): ActiveSkillRef[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return normalizeRefs(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function getActiveSkillIds(): string[] {
  return getActiveSkillRefs().map((r) => r.slug);
}

export function setActiveSkillRefs(refs: ActiveSkillRef[]): void {
  const normalized = normalizeRefs(refs);
  const payload = normalized.map((r) => (r.name ? { slug: r.slug, name: r.name } : r.slug));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  window.dispatchEvent(
    new CustomEvent(SKILL_SELECTION_CHANGED_EVENT, {
      detail: { skillIds: normalized.map((r) => r.slug), skills: normalized },
    }),
  );
}

export function setActiveSkillIds(ids: string[]): void {
  const prev = getActiveSkillRefs();
  const nameBySlug = new Map(prev.map((r) => [r.slug, r.name]));
  setActiveSkillRefs(
    ids.map((id) => {
      const slug = String(id || '').trim();
      const name = nameBySlug.get(slug);
      return name ? { slug, name } : { slug };
    }),
  );
}

export function isSkillActive(slug: string): boolean {
  const id = (slug || '').trim();
  return Boolean(id) && getActiveSkillIds().includes(id);
}

export function toggleActiveSkill(slug: string, enabled: boolean, name?: string): string[] {
  const id = (slug || '').trim();
  if (!id) return getActiveSkillIds();
  const current = getActiveSkillRefs();
  let next: ActiveSkillRef[];
  if (enabled) {
    if (current.some((r) => r.slug === id)) {
      next = current.map((r) =>
        r.slug === id && name ? { slug: id, name: name.trim() || r.name } : r,
      );
    } else {
      const trimmed = (name || '').trim();
      next = [...current, trimmed ? { slug: id, name: trimmed } : { slug: id }];
    }
  } else {
    next = current.filter((r) => r.slug !== id);
  }
  setActiveSkillRefs(next);
  return next.map((r) => r.slug);
}

export function clearActiveSkills(): void {
  setActiveSkillRefs([]);
}

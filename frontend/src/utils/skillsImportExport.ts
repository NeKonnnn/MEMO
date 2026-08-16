/** Import / export skills — общий код для SkillsPage и SkillsSidebarPanel. */

import { getApiUrl, API_ENDPOINTS } from '../config/api';

export const SKILLS_CHANGED_EVENT = 'astrachatSkillsChanged';

export function notifySkillsChanged(): void {
  window.dispatchEvent(new CustomEvent(SKILLS_CHANGED_EVENT));
}

/** Как backend slugify_skill_id: только a-z0-9._- (кириллица отбрасывается). */
export function slugifySkillName(name: string): string {
  const s = (name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s || `skill-${Date.now().toString(36)}`;
}

export function formatSkillsApiDetail(detail: unknown, fallback = 'Ошибка'): string {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const o = item as { msg?: string; loc?: unknown[] };
          const loc = Array.isArray(o.loc) ? o.loc.join('.') : '';
          return [loc, o.msg].filter(Boolean).join(': ');
        }
        return '';
      })
      .filter(Boolean);
    if (parts.length) return parts.join('; ');
  }
  if (detail && typeof detail === 'object' && 'message' in detail) {
    return String((detail as { message: unknown }).message || fallback);
  }
  return fallback;
}

export function parseSkillFrontmatter(md: string): {
  name?: string;
  description?: string;
  body: string;
} {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { body: md };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return { name: meta.name, description: meta.description, body: m[2] || '' };
}

function authHeaders(token: string | null | undefined): HeadersInit {
  const h: HeadersInit = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function exportSkillsJson(token: string | null | undefined): Promise<void> {
  const resp = await fetch(`${getApiUrl(API_ENDPOINTS.SKILLS)}/export`, {
    headers: authHeaders(token),
  });
  if (!resp.ok) throw new Error('Export failed');
  const data = await resp.json();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `skills-export-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export type SkillMdImportResult = {
  kind: 'md';
  name: string;
  slug: string;
  description: string;
  content: string;
};

export type SkillJsonImportResult = {
  kind: 'json';
  imported: number;
};

export type SkillImportResult = SkillMdImportResult | SkillJsonImportResult;

/** Импорт .json (создаёт skills) или .md/.txt (возвращает поля для формы). */
export async function importSkillFile(
  file: File,
  token: string | null | undefined,
): Promise<SkillImportResult> {
  const text = await file.text();
  if (file.name.endsWith('.json')) {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    let imported = 0;
    for (const item of list) {
      const payload = {
        slug: item.slug || slugifySkillName(item.name || 'skill'),
        name: item.name || item.slug || 'Imported skill',
        description: item.description || null,
        content: item.content || '',
        is_active: item.is_active !== false,
        is_public: Boolean(item.is_public),
        meta: item.meta || { tags: [] },
      };
      if (!payload.content) continue;
      const resp = await fetch(`${getApiUrl(API_ENDPOINTS.SKILLS)}/create`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify(payload),
      });
      if (resp.ok) imported += 1;
    }
    if (imported > 0) notifySkillsChanged();
    return { kind: 'json', imported };
  }
  const { name, description, body } = parseSkillFrontmatter(text);
  const displayName = name || file.name.replace(/\.(md|txt)$/i, '');
  return {
    kind: 'md',
    name: displayName,
    slug: slugifySkillName(name || file.name),
    description: description || '',
    content: body,
  };
}

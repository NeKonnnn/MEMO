import { getApiUrl } from '../config/api';

export type DirectoryUserHit = {
  user_id: string;
  username: string;
  full_name?: string | null;
  email?: string | null;
};

export async function searchDirectoryUsers(
  token: string,
  q: string,
  limit = 10,
): Promise<DirectoryUserHit[]> {
  const query = (q || '').trim();
  if (query.length < 2) return [];
  const resp = await fetch(
    getApiUrl(`/api/users/search?q=${encodeURIComponent(query)}&limit=${limit}`),
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) return [];
  const data = await resp.json().catch(() => ({}));
  return Array.isArray(data?.users) ? data.users : [];
}

function looksLikeLogin(part: string): boolean {
  // gpbu… / простой логин без пробелов и без @
  return /^[a-zA-Z0-9._-]+$/.test(part) && !part.includes('@');
}

/**
 * Разобрать ввод (gpbu / ФИО / email, через запятую) в логины для POST /share.
 * Для неоднозначных токенов берём точное совпадение из LDAP search.
 */
export async function resolveShareUsernames(
  token: string,
  rawInput: string,
): Promise<{ usernames: string[]; unresolved: string[] }> {
  const parts = rawInput
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return { usernames: [], unresolved: [] };

  const usernames: string[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  const push = (uid: string) => {
    const key = uid.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    usernames.push(uid.trim());
  };

  for (const part of parts) {
    if (looksLikeLogin(part)) {
      push(part);
      continue;
    }
    const hits = await searchDirectoryUsers(token, part, 8);
    const lower = part.toLowerCase();
    const exact =
      hits.find((h) => (h.username || h.user_id || '').toLowerCase() === lower) ||
      hits.find((h) => (h.email || '').toLowerCase() === lower) ||
      hits.find((h) => (h.full_name || '').toLowerCase() === lower) ||
      (hits.length === 1 ? hits[0] : undefined);

    if (exact?.user_id || exact?.username) {
      push(exact.username || exact.user_id);
    } else {
      unresolved.push(part);
    }
  }

  return { usernames, unresolved };
}

export function directoryUserOptionLabel(u: DirectoryUserHit): string {
  const fio = (u.full_name || '').trim();
  const login = (u.username || u.user_id || '').trim();
  const email = (u.email || '').trim();
  if (fio) return fio;
  return login || email || '';
}

export function directoryUserOptionSecondary(u: DirectoryUserHit): string {
  const login = (u.username || u.user_id || '').trim();
  const email = (u.email || '').trim();
  if (login && email) return `${login} · ${email}`;
  return email || login;
}

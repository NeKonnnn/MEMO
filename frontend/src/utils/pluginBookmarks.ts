const STORAGE_KEY = 'astrachat_plugin_bookmarks';

function readIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

function writeIds(ids: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

export function getPluginBookmarkIds(): Set<string> {
  return new Set(readIds());
}

export function isPluginBookmarked(pluginId: string): boolean {
  return getPluginBookmarkIds().has(pluginId);
}

/** Добавить/убрать закладку. Возвращает новое состояние isBookmarked. */
export function togglePluginBookmark(pluginId: string): boolean {
  const ids = readIds();
  const idx = ids.indexOf(pluginId);
  if (idx >= 0) {
    ids.splice(idx, 1);
    writeIds(ids);
    return false;
  }
  ids.push(pluginId);
  writeIds(ids);
  return true;
}

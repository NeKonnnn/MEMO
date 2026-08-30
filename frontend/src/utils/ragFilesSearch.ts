/** Нормализация строки поиска по имени файла RAG (без учёта регистра). */
export function normalizeRagFilenameQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** Совпадение имени файла с поисковым запросом (подстрока, case-insensitive). */
export function ragFilenameMatchesQuery(filename: string, query: string): boolean {
  const q = normalizeRagFilenameQuery(query);
  if (!q) return true;
  return String(filename || '')
    .toLowerCase()
    .includes(q);
}

/** Фильтр списка документов/pending-загрузок по имени файла. */
export function filterByRagFilenameQuery<T extends { filename: string }>(
  items: readonly T[],
  query: string,
): T[] {
  const q = normalizeRagFilenameQuery(query);
  if (!q) return [...items];
  return items.filter((item) => ragFilenameMatchesQuery(item.filename, q));
}

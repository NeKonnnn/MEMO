/**
 * Локальный номер документа в текущем списке (1…N), не глобальный SERIAL из SVC-RAG.
 *
 * Нумерация по порядку загрузки (created_at ↑, при равенстве — id ↑), чтобы в каждом
 * проекте / агенте / общей библиотеке счёт шёл заново: 1, 2, 3…, а не 21, 22…
 */
export function ragDocumentDisplayIndex(
  docs: ReadonlyArray<{ id: number; created_at?: string | null }>,
  docId: number,
): number {
  if (!docs.length) return 0;
  const sorted = [...docs].sort((a, b) => {
    const ta = a.created_at ? Date.parse(String(a.created_at)) : NaN;
    const tb = b.created_at ? Date.parse(String(b.created_at)) : NaN;
    const aOk = Number.isFinite(ta);
    const bOk = Number.isFinite(tb);
    if (aOk && bOk && ta !== tb) return ta - tb;
    if (aOk !== bOk) return aOk ? -1 : 1;
    return a.id - b.id;
  });
  const idx = sorted.findIndex((d) => d.id === docId);
  return idx >= 0 ? idx + 1 : 0;
}

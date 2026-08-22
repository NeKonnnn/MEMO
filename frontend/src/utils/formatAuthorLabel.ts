/** Отображение автора: «ФИО · gpbu» или только gpbu. */

export function formatAuthorLabel(
  authorName?: string | null,
  authorFullName?: string | null,
  authorId?: string | null,
): string {
  const gpbu = (authorName || authorId || '').trim();
  const fio = (authorFullName || '').trim();
  if (fio && gpbu && fio.toLowerCase() !== gpbu.toLowerCase()) {
    return `${fio} · ${gpbu}`;
  }
  return fio || gpbu || '';
}

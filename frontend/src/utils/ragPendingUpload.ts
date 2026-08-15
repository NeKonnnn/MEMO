import { flushSync } from 'react-dom';

export interface RagPendingUpload {
  clientId: string;
  filename: string;
  size: number;
}

export function createRagPendingUploads(files: File[]): RagPendingUpload[] {
  return files.map((file) => ({
    clientId: `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name}`,
    filename: file.name,
    size: file.size,
  }));
}

export function removeRagPendingUploads(
  pending: RagPendingUpload[],
  clientIds: string[],
): RagPendingUpload[] {
  if (!clientIds.length) return pending;
  const drop = new Set(clientIds);
  return pending.filter((item) => !drop.has(item.clientId));
}

export function getRagFileTypeLabel(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'PDF';
  if (['docx', 'doc', 'docm'].includes(ext)) return 'Word';
  if (['xlsx', 'xls', 'xlsm', 'csv'].includes(ext)) return 'Excel';
  if (['txt', 'md', 'log'].includes(ext)) return 'TXT';
  if (ext === 'rtf') return 'RTF';
  return 'File';
}

/** id документа из ответа POST upload (KB / project / memory RAG). */
export function parseRagUploadDocumentId(payload: unknown): number | null {
  if (payload == null) return null;
  if (typeof payload === 'number' && Number.isFinite(payload) && payload > 0) {
    return payload;
  }
  if (typeof payload !== 'object') return null;

  const record = payload as Record<string, unknown>;
  for (const key of ['document_id', 'documentId', 'id'] as const) {
    const value = record[key];
    if (value == null || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  for (const nestedKey of ['document', 'data', 'result'] as const) {
    const nested = record[nestedKey];
    if (nested != null) {
      const nestedId = parseRagUploadDocumentId(nested);
      if (nestedId != null) return nestedId;
    }
  }

  return null;
}

/** Объединить списки документов по id (серверные поля перекрывают локальные). */
export function mergeRagDocumentsById<T extends { id: number }>(
  prev: T[],
  incoming: T[],
): T[] {
  const byId = new Map<number, T>();
  for (const doc of prev) byId.set(doc.id, doc);
  for (const doc of incoming) byId.set(doc.id, doc);
  return Array.from(byId.values());
}

/** Сразу отрисовать UI после загрузки одного файла (не ждать конца пакета). */
export function commitRagUploadUiUpdate(update: () => void): void {
  flushSync(update);
}

/** Сколько RAG-файлов индексировать одновременно (не перегружать embed-сервис). */
export const RAG_UPLOAD_CONCURRENCY = 3;

/**
 * Параллельный обход с ограничением concurrency.
 * Нужен, чтобы пакет из N документов не ждал сумму всех индексаций подряд.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  if (!items.length) return results;
  let nextIndex = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const runners = Array.from({ length: limit }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

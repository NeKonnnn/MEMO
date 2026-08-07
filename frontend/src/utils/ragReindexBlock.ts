/** Сущность, которую пересобирают прямо сейчас. */
export interface RagReindexActiveEntity {
  scope: 'agent' | 'project' | string;
  entity_id: string | null;
  name?: string | null;
}

export interface RagReindexStatusPayload {
  memory: { reindexing: boolean };
  project: { reindexing: boolean };
  kb: { reindexing: boolean };
  any_reindexing: boolean;
  agent_has_kb: boolean;
  project_has_documents: boolean;
  memory_rag_enabled: boolean;
  message: string;
  /**
   * Что именно пересобирается. Пусто у старого backend — тогда работает
   * прежняя логика по флагам стора.
   */
  active?: RagReindexActiveEntity[];
}

export const MEMORY_RAG_DISABLED_HINT =
  'Поиск по общей библиотеке отключен администратором';

export const RAG_REINDEX_BLOCK_PLACEHOLDER =
  'Идёт перечанковка документов — дождитесь завершения';

export interface RagSendBlockContext {
  libraryEnabled: boolean;
  /** С сервера: в текущем проекте есть документы в project-rag. */
  projectHasDocuments: boolean;
  /** С сервера: у выбранного агента есть KB-документы в сторе. */
  agentHasKb: boolean;
  /** Агент и проект текущего чата — по ним понимаем, наша ли это пересборка. */
  agentId?: number | string | null;
  projectId?: string | null;
}

function isEntityRebuilding(
  active: RagReindexActiveEntity[] | undefined,
  scope: 'agent' | 'project',
  entityId: number | string | null | undefined,
): boolean {
  const id = String(entityId ?? '').trim();
  if (!id || !active?.length) return false;
  return active.some(
    (item) => item?.scope === scope && String(item?.entity_id ?? '').trim() === id,
  );
}

/** Идёт ли перечанковка для конкретного агента или проекта. */
export function isRagEntityRebuilding(
  status: RagReindexStatusPayload | null | undefined,
  scope: 'agent' | 'project',
  entityId: number | string | null | undefined,
): boolean {
  if (!status) return false;
  const id = String(entityId ?? '').trim();
  if (!id) return false;
  // Пустой active[] = никто не пересобирается. Нельзя падать в fallback
  // kb.reindexing: иначе после завершения все агенты остаются «заблокированы».
  if (Array.isArray(status.active)) {
    return isEntityRebuilding(status.active, scope, entityId);
  }
  // Старый backend без поля active
  if (scope === 'project' && status.project?.reindexing) return true;
  if (scope === 'agent' && status.kb?.reindexing) return true;
  return false;
}

/** Блокировать отправку, если перечанковка затрагивает активный для чата RAG-источник. */
export function shouldBlockRagSend(
  status: RagReindexStatusPayload | null | undefined,
  ctx: RagSendBlockContext,
): boolean {
  if (!status) return false;
  if (status.memory?.reindexing && ctx.libraryEnabled) return true;

  // Пересобираться могут несколько сущностей параллельно, поэтому флага стора
  // мало: он поднят и когда чинят ЧУЖОГО агента. Блокируем, только если в списке
  // активных есть агент или проект этого чата.
  const active = status.active;
  if (active?.length) {
    if (ctx.projectHasDocuments && isEntityRebuilding(active, 'project', ctx.projectId)) {
      return true;
    }
    if (ctx.agentHasKb && isEntityRebuilding(active, 'agent', ctx.agentId)) {
      return true;
    }
    return false;
  }

  // Старый backend без ```active``` — прежнее поведение по флагам стора.
  if (status.project?.reindexing && ctx.projectHasDocuments) return true;
  if (status.kb?.reindexing && ctx.agentHasKb) return true;
  return false;
}

export interface RagReindexBannerContext {
  agentId?: number | string | null;
  projectId?: string | null;
}

/**
 * Сущности, из‑за которых этому клиенту нужна оранжевая плашка.
 *
 * Агенты: как раньше — любой агент в ```active``` (подсказки в меню и плашка
 * работают по тому же реестру).
 * Проекты: только текущий открытый проект. Иначе чужая перечанковка проекта
 * поднимала плашку у всех пользователей приложения.
 */
function relevantActiveForBanner(
  status: RagReindexStatusPayload,
  ctx: RagReindexBannerContext,
): RagReindexActiveEntity[] {
  const active = status.active;
  if (!Array.isArray(active) || !active.length) return [];
  const projectId = String(ctx.projectId ?? '').trim();
  return active.filter((item) => {
    const scope = String(item?.scope || '');
    if (scope === 'agent') return true;
    if (scope === 'project') {
      if (!projectId) return false;
      return String(item?.entity_id ?? '').trim() === projectId;
    }
    return false;
  });
}

function formatActiveEntityTitle(item: RagReindexActiveEntity): string {
  const scope = String(item?.scope || '');
  const kind = scope === 'agent' ? 'агента' : 'проекта';
  const name = String(item?.name || '').trim();
  const eid = String(item?.entity_id || '').trim();
  return name ? `${kind} «${name}»` : `${kind} ${eid}`.trim();
}

function buildBannerMessageFromActive(relevant: RagReindexActiveEntity[]): string {
  const titles: string[] = [];
  for (const item of relevant) {
    const title = formatActiveEntityTitle(item);
    if (title && !titles.includes(title)) titles.push(title);
  }
  if (!titles.length) return '';
  const stores =
    titles.length === 1
      ? titles[0]
      : `${titles.slice(0, -1).join(', ')} и ${titles[titles.length - 1]}`;
  return (
    `Идёт пересборка ${stores}. ` +
    'Поиск по ним временно недоступен — дождитесь завершения, иначе ответ может быть «Не знаю».'
  );
}

/** Показывать ли верхнюю оранжевую плашку этому клиенту. */
export function isRagReindexBannerVisible(
  status: RagReindexStatusPayload | null | undefined,
  ctx: RagReindexBannerContext,
): boolean {
  if (!status) return false;
  if (status.memory?.reindexing) return true;
  if (Array.isArray(status.active)) {
    return relevantActiveForBanner(status, ctx).length > 0;
  }
  // Старый backend без ```active```.
  if (status.kb?.reindexing) return true;
  if (status.project?.reindexing && String(ctx.projectId ?? '').trim()) return true;
  return false;
}

export function ragReindexBlockMessage(
  status: RagReindexStatusPayload | null | undefined,
  ctx?: RagReindexBannerContext,
): string {
  if (!status) return RAG_REINDEX_BLOCK_PLACEHOLDER;

  // Без контекста — сырое сообщение сервера (блокировка отправки и т.п.).
  if (!ctx) {
    const msg = status.message?.trim();
    return msg || RAG_REINDEX_BLOCK_PLACEHOLDER;
  }

  if (status.memory?.reindexing) {
    const msg = status.message?.trim();
    return msg || RAG_REINDEX_BLOCK_PLACEHOLDER;
  }

  if (Array.isArray(status.active)) {
    const relevant = relevantActiveForBanner(status, ctx);
    if (!relevant.length) return '';
    return buildBannerMessageFromActive(relevant) || RAG_REINDEX_BLOCK_PLACEHOLDER;
  }

  if (!isRagReindexBannerVisible(status, ctx)) return '';
  const msg = status.message?.trim();
  return msg || RAG_REINDEX_BLOCK_PLACEHOLDER;
}

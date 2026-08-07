"""
Порог релевантности RAG и короткий ответ без вызова LLM, если в документах нет опоры.

Скоры из SVC-RAG: cosine similarity ≈ 1 - (embedding <=> query), обычно в [0, 1].
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Tuple

from backend.rag_query.prompts import RAG_STRICT_NOT_FOUND_MESSAGE
from backend.settings.logging import get_logger

logger = get_logger(__name__)

RAG_NO_RELEVANT_CONTEXT_MESSAGE = RAG_STRICT_NOT_FOUND_MESSAGE


def _rag_env_flag(name: str, default: bool) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    return raw in ("1", "true", "yes", "on")

def memory_rag_enabled() -> bool:
    """Глобальный выключатель Библиотеки: ```RAG_MEMORY_ENABLED=0```

    Выключает ИСТОЧНИК, а не кнопку в UI: тумблер у пользователя остаётся, но
    memory-rag в поиск не попадает ни в одном режиме чата. Нужен, когда
    Библиотека наполнена мусором или переиндексируется, а ронять остальной RAG
    нельзя
    """
    return _rag_env_flag("RAG_MEMORY_ENABLED", True)


def build_rag_id_to_filename(rows: Optional[List[Any]]) -> Dict[int, str]:
    """Сопоставление id документа в SVC-RAG с именем файла для подписей в промпте (без вывода числового id)."""
    out: Dict[int, str] = {}
    if not rows:
        return out
    for d in rows:
        if not isinstance(d, dict):
            continue
        raw_id = d.get("id")
        if raw_id is None:
            continue
        try:
            key = int(raw_id)
        except (TypeError, ValueError):
            continue
        name = d.get("filename")
        label = (str(name).strip() if name else "") or str(key)
        out[key] = label
    return out


def rag_document_label(doc_id: Optional[Any], id_to_name: Dict[int, str]) -> str:
    """Подпись источника фрагмента для LLM: имя файла, не внутренний document_id."""
    if doc_id is None:
        return "неизвестный документ"
    try:
        key = int(doc_id)
    except (TypeError, ValueError):
        return "неизвестный документ"
    name = id_to_name.get(key)
    if name and str(name).strip():
        return str(name).strip()
    return "документ без имени"


class ActiveRagSources:
    """Какие RAG-источники активны для текущего запроса.

    Единое правило подмешивания (одинаковое для direct / multi-LLM / agent):

      * ``memory``    — библиотека памяти (кнопка «Библиотека»); только если тумблер включён;
      * ``agent_kb``  — документы выбранного агента; только если у агента включён
                        file_search и есть привязанные kb_document_ids;
      * ``project``   — RAG-документы проекта; только если чат открыт в проекте.

    Все активные источники используются вместе (аддитивно). Выключенные —
    НИКОГДА не подмешиваются. Это гарантирует, что, например, memory-only в
    обычном чате не приводит к утечке project/agent документов, а project-only
    не тянет memory/agent.
    """

    __slots__ = ("project", "agent_kb", "memory")

    def __init__(self, *, project: bool, agent_kb: bool, memory: bool) -> None:
        self.project = bool(project)
        self.agent_kb = bool(agent_kb)
        self.memory = bool(memory)

    @property
    def any(self) -> bool:
        return self.project or self.agent_kb or self.memory

    def as_dict(self) -> Dict[str, bool]:
        return {"project": self.project, "agent_kb": self.agent_kb, "memory": self.memory}

    def store_list(self) -> List[str]:
        """Имена SVC-RAG store'ов, разрешённые к поиску (для agentic tool)."""
        out: List[str] = []
        if self.project:
            out.append("project")
        if self.agent_kb:
            out.append("kb")
        if self.memory:
            out.append("memory")
        return out


def resolve_active_rag_sources(
    *,
    project_id: Optional[Any],
    use_agent_scoped_kb: bool,
    agent_kb_doc_ids: Optional[List[Any]],
    use_memory_library_rag: bool,
    use_kb_rag: bool = False,
) -> ActiveRagSources:
    """Единая точка решения, какие источники RAG активны.

    Используется всеми режимами чата и agentic-tool'ом, чтобы правило было
    одинаковым и тестируемым.

    ВАЖНО про «Библиотеку»: в UI одна кнопка «Библиотека» ставит СРАЗУ два флага
    (``use_kb_rag`` и ``use_memory_library_rag``) — это единый тумблер «искать в
    моих загруженных документах». Документы, загруженные через «Открыть базу
    данных» в настройках RAG, лежат в memory-rag. Поэтому memory-поиск включаем
    по ЛЮБОМУ из этих флагов: иначе, если фронт по какой-то причине прислал
    только ``use_kb_rag`` (а он исторически был no-op для retrieval), библиотека
    не искалась вообще и чат отвечал «не нашёл», хотя документы загружены.
    """
    project = bool(project_id)
    agent_kb = bool(use_agent_scoped_kb) and bool(agent_kb_doc_ids) and len(agent_kb_doc_ids) > 0
    memory = bool(use_memory_library_rag) or bool(use_kb_rag)
    if memory and not memory_rag_enabled():
        logger.info(
            "[RAG-SOURCES] Библиотека выключена глобально (RAG_MEMORY_ENABLED=0) - "
            "тумблер пользователя игнорируем"
        )
        memory = False
    sources = ActiveRagSources(project=project, agent_kb=agent_kb, memory=memory)
    logger.debug(
        "[RAG-SOURCES] active=%s (project_id=%s, use_agent_scoped_kb=%s, agent_kb_docs=%s, "
        "use_memory_library_rag=%s, use_kb_rag=%s)",
        sources.as_dict(),
        project_id,
        use_agent_scoped_kb,
        len(agent_kb_doc_ids or []),
        use_memory_library_rag,
        use_kb_rag,
    )
    return sources


def should_block_rag_send(
    status: Dict[str, Any],
    *,
    library_enabled: bool,
    project_has_documents: bool = False,
    agent_has_kb: bool = False,
) -> bool:
    """Зеркало фронтового shouldBlockRagSend — блок только затронутых RAG-источников."""
    if not status:
        return False
    if library_enabled and bool((status.get("memory") or {}).get("reindexing")):
        return True
    if project_has_documents and bool((status.get("project") or {}).get("reindexing")):
        return True
    if agent_has_kb and bool((status.get("kb") or {}).get("reindexing")):
        return True
    return False


async def rag_reindex_blocks_active_sources(
    sources: ActiveRagSources,
    rag_client: Any,
    *,
    project_id: Optional[Any] = None,
) -> bool:
    """Proactive guard: lock SVC-RAG до вызова search."""
    if not sources.any or not rag_client:
        return False
    try:
        status = await rag_client.get_reindex_status()
    except Exception:
        logger.warning("[RAG] proactive reindex status check failed", exc_info=True)
        return False
    if sources.memory and bool((status.get("memory") or {}).get("reindexing")):
        return True
    if sources.project and bool((status.get("project") or {}).get("reindexing")):
        if not project_id:
            return False
        try:
            docs = list(await rag_client.project_rag_list_documents(project_id) or [])
        except Exception:
            logger.warning("[RAG] project_rag_list_documents failed during reindex guard", exc_info=True)
            return False
        if docs:
            return True
    if sources.agent_kb and bool((status.get("kb") or {}).get("reindexing")):
        return True
    return False


def _entity_titles(active: Optional[list]) -> list:
    """«агента «Юрист»» / «проекта «Отчётность»» — по одной строке на сущность."""
    out: list = []
    for item in active or []:
        if not isinstance(item, dict):
            continue
        kind = "агента" if str(item.get("scope") or "") == "agent" else "проекта"
        name = str(item.get("name") or "").strip()
        eid = str(item.get("entity_id") or "").strip()
        title = f"{kind} «{name}»" if name else f"{kind} {eid}".strip()
        if title not in out:
            out.append(title)
    return out


def build_reindex_status_message(
    *,
    memory_reindexing: bool,
    project_reindexing: bool,
    kb_reindexing: bool,
    active: Optional[list] = None,
) -> str:
    # Пересобирается конкретная сущность — называем её: плашка видна всем, кто с
    # ней работает, и «идёт перечанковка базы знаний агента» без имени в такой
    # ситуации не отвечает на вопрос «какого именно».
    titles = _entity_titles(active)
    if titles and not memory_reindexing:
        stores = titles[0] if len(titles) == 1 else ", ".join(titles[:-1]) + f" и {titles[-1]}"
        return (
            f"Идёт пересборка {stores}. "
            "Поиск по ним временно недоступен — дождитесь завершения, иначе ответ может быть «Не знаю»."
        )
    parts: list[str] = []
    if memory_reindexing:
        parts.append("Библиотеки")
    if project_reindexing:
        parts.append("документов проекта")
    if kb_reindexing:
        parts.append("базы знаний агента")
    if not parts:
        return ""
    if len(parts) == 1:
        stores = parts[0]
    elif len(parts) == 2:
        stores = f"{parts[0]} и {parts[1]}"
    else:
        stores = f"{parts[0]}, {parts[1]} и {parts[2]}"
    return (
        f"Идёт перечанковка {stores}. "
        "Поиск по базе временно недоступен — дождитесь завершения, иначе ответ может быть «Не знаю»."
    )


def rag_guard_env(scope: Optional[str] = None) -> Tuple[float, bool]:
    """(min_similarity, block_on_no_evidence).

    ``scope`` — стор, чьи хиты фильтруем: "agent" или "project". Порог теперь
    у каждой сущности свой, и общий на оба стора обрезал бы выдачу не тем числом.

    ВАЖНО: по умолчанию backend НЕ отсекает по score (min_sim=0), потому что SVC-RAG уже
    применил ``min_vector_similarity`` + rescue top-N, и результат может быть в разных
    шкалах (чистый cosine / смесь cross-encoder+cosine / BM25 RRF). Любой дополнительный
    порог здесь снова обнуляет recall. Включать RAG_MIN_SIMILARITY>0 имеет смысл только
    когда вы умышленно отключили rescue и все шкалы приведены к [0, 1].

    RAG_BLOCK_ON_NO_EVIDENCE=1 (по умолчанию) — если после всех фильтров контекст действительно
    пуст, backend сам отвечает канонической фразой без вызова LLM. Чтобы ВСЕГДА звать LLM
    (даже без опоры на документы), поставьте RAG_BLOCK_ON_NO_EVIDENCE=0.
    """
    min_sim = None
    try:
        from backend.services.user_rag_settings import runtime_rag_similarity_threshold

        min_sim = float(runtime_rag_similarity_threshold(scope))
    except Exception:
        logger.exception("RAG similarity threshold runtime read")
        min_sim = None
    if min_sim is None:
        try:
            import backend.app_state as state

            min_sim = float(getattr(state, "rag_similarity_threshold", 0.0))
        except Exception:
            logger.exception("RAG similarity threshold state read")
            min_sim = None
    if min_sim is None:
        try:
            min_sim = float(os.getenv("RAG_MIN_SIMILARITY", "0"))
        except ValueError:
            min_sim = 0.0
    min_sim = max(0.0, min(min_sim, 1.0))
    block = os.getenv("RAG_BLOCK_ON_NO_EVIDENCE", "1").strip().lower() not in ("0", "false", "no", "off")
    return (min_sim, block)


def filter_rag_hits_by_score(
    hits: Optional[List[Tuple[str, float, Optional[int], Optional[int]]]], min_score: float
) -> List[Tuple[str, float, Optional[int], Optional[int]]]:
    if not hits:
        return []
    if min_score <= 0.0:
        return list(hits)
    out: List[Tuple[str, float, Optional[int], Optional[int]]] = []
    raw_scores: List[float] = []
    for h in hits:
        try:
            s = float(h[1])
            raw_scores.append(s)
            if s >= min_score:
                out.append(h)
        except (TypeError, ValueError):
            continue
    if not out and raw_scores:
        mx = max(raw_scores)
        if mx < min_score and mx < 0.0:
            logger.debug(
                "[RAG] Порог RAG_MIN_SIMILARITY=%s не применён: шкала похожа на реранк (max score=%.4f < 0). Оставляем хиты как отдал SVC-RAG; при необходимости задайте RAG_RERANK_MIN_SCORE в svc-rag.",
                min_score,
                mx,
            )
            return list(hits)
        if 0.0 <= mx < min_score:
            try:
                rescue = int(os.getenv("RAG_RESCUE_LOW_SCORE_TOP", "10"))
            except ValueError:
                rescue = 10
            rescue = max(4, min(rescue, 24))
            ranked = sorted([h for h in hits if len(h) > 1], key=lambda h: float(h[1]), reverse=True)
            if ranked:
                logger.debug(
                    "[RAG] max score=%.4f < RAG_MIN_SIMILARITY=%s — спасение recall: топ-%s чанков.",
                    mx,
                    min_score,
                    rescue,
                )
                return ranked[:rescue]
        logger.debug(
            "[RAG] Все %s хитов отсечены порогом RAG_MIN_SIMILARITY=%s (макс. score до фильтра: %.4f). Уменьшите RAG_MIN_SIMILARITY в окружении, если ответы есть в документах, но контекст пуст.",
            len(hits),
            min_score,
            mx,
        )
    return out


def _format_single_fragment(
    row: Tuple[str, float, Optional[int], Optional[int]],
    *,
    number: int,
    id_to_name: Dict[int, str],
    include_chunk_meta: bool,
) -> Optional[str]:
    try:
        content, score, doc_id, chunk_idx = row
    except (TypeError, ValueError):
        return None
    title = rag_document_label(doc_id, id_to_name)
    if include_chunk_meta:
        try:
            from backend.rag_query.relevance import (
                relevance_percent_or_none,
                score_to_relevance_percent,
            )

            # По сырому cosine, если он доехал из SVC-RAG: score здесь может
            # быть в шкале стратегии (RRF / логит реранкера), и процент по нему
            # ввёл бы модель в заблуждение.
            sc_pct = relevance_percent_or_none(row)
            if sc_pct is None:
                sc_pct = score_to_relevance_percent(score)
        except Exception:
            sc_pct = 1
        return f"Фрагмент {number} (документ «{title}», чанк {chunk_idx}, релевантность: {sc_pct}%):\n{content}\n"
    return f"Фрагмент {number} (документ «{title}»): {content}\n"


def format_rag_fragments(
    hits: Optional[List[Tuple[str, float, Optional[int], Optional[int]]]],
    id_to_name: Dict[int, str],
    *,
    max_chars: int,
    store_label: str,
    include_chunk_meta: bool = False,
    # По умолчанию False: номер чанка и релевантность - служебная разметка, модель
    # копирует ее в ответ пользователю. Значения остаются в логах и рассировке.
    truncate_marker: str = "\n... [обрезано]\n",
) -> Tuple[List[str], Dict[str, int]]:
    """Единая формализация RAG-хитов в текстовые фрагменты с бюджетом длины.

    Два фундаментальных свойства:

    1. **Round-robin по документам**. Раньше обход был линейный: брали чанки
       в порядке SVC-RAG, и как только бюджет кончался — break. Если первые
       несколько документов были крупными (по 6 жирных чанков), остальные
       документы ВООБЩЕ не попадали в промпт — даже если были семантически
       самыми релевантными. Пользователь видел это как «SVC-RAG нашёл 3
       документа, но LLM ответил будто видел только один».

       Теперь: сначала по одному чанку от каждого document_id (в порядке
       первого появления в hits) — это гарантирует coverage всех документов.
       Затем второй проход берёт следующие чанки документов по порядку, пока
       не кончится бюджет. Итоговая нумерация фрагментов сохраняет исходный
       порядок hits (важно для подписей `Фрагмент N`).

    2. **Явный лог согласования метрик** SVC-RAG ↔ LLM-промпт:

           [RAG/fragments] store=memory: получено=17, попало_в_промпт_целиком=12,
           документов_в_промпт=3/3, последний_обрезан=1, отброшено=4, длина=9873

    Возвращает:
      * parts — готовые строки для `"\\n".join(parts)`;
      * metrics — dict для верхнего лога и, при желании, для ответа API.
    """
    hits = hits or []
    metrics: Dict[str, int] = {
        "received": len(hits),
        "used_full": 0,
        "truncated_last": 0,
        "dropped": 0,
        "total_chars": 0,
        "documents_input": 0,
        "documents_in_prompt": 0,
    }
    if not hits:
        return ([], metrics)
    doc_order: List[Optional[int]] = []
    doc_seen: set = set()
    for row in hits:
        try:
            _, _, d_id, _ = row
        except (TypeError, ValueError):
            continue
        if d_id not in doc_seen:
            doc_seen.add(d_id)
            doc_order.append(d_id)
    metrics["documents_input"] = len(doc_order)
    indexed: List[Tuple[int, Optional[int], Tuple[str, float, Optional[int], Optional[int]]]] = []
    for i, row in enumerate(hits):
        try:
            _, _, d_id, _ = row
        except (TypeError, ValueError):
            continue
        indexed.append((i + 1, d_id, row))
    by_doc: Dict[Optional[int], List[int]] = {}
    for num, d_id, _row in indexed:
        by_doc.setdefault(d_id, []).append(num - 1)
    selected_entries: List[Optional[str]] = [None] * len(indexed)
    selected_doc_ids: set = set()
    total = 0
    truncated_last = False
    reserve_for_marker = len(truncate_marker)

    def _try_add(idx: int) -> bool:
        nonlocal total
        if selected_entries[idx] is not None:
            return True
        num, d_id, row = indexed[idx]
        frag = _format_single_fragment(row, number=num, id_to_name=id_to_name, include_chunk_meta=include_chunk_meta)
        if frag is None:
            return False
        if total + len(frag) + reserve_for_marker > max_chars:
            return False
        selected_entries[idx] = frag
        selected_doc_ids.add(d_id)
        total += len(frag)
        return True

    for d_id in doc_order:
        idxs = by_doc.get(d_id) or []
        for idx in idxs:
            if _try_add(idx):
                break
    for idx, (num, d_id, row) in enumerate(indexed):
        if selected_entries[idx] is not None:
            continue
        if _try_add(idx):
            continue
        if total + reserve_for_marker < max_chars:
            frag = _format_single_fragment(
                row, number=num, id_to_name=id_to_name, include_chunk_meta=include_chunk_meta
            )
            if frag is not None:
                tail = max(0, max_chars - total - reserve_for_marker)
                selected_entries[idx] = frag[:tail] + truncate_marker
                selected_doc_ids.add(d_id)
                total += len(selected_entries[idx])
                truncated_last = True
        break
    parts: List[str] = [p for p in selected_entries if p is not None]
    used_count = len(parts)
    metrics["used_full"] = used_count - (1 if truncated_last else 0)
    metrics["truncated_last"] = 1 if truncated_last else 0
    metrics["dropped"] = max(0, len(indexed) - used_count)
    metrics["total_chars"] = total
    metrics["documents_in_prompt"] = len(selected_doc_ids)
    logger.debug(
        "[RAG/fragments] store=%s: получено=%d, попало_в_промпт_целиком=%d, документов_в_промпт=%d/%d, последний_обрезан=%d, отброшено_после_лимита=%d, длина=%d/%d",
        store_label,
        metrics["received"],
        metrics["used_full"],
        metrics["documents_in_prompt"],
        metrics["documents_input"],
        metrics["truncated_last"],
        metrics["dropped"],
        metrics["total_chars"],
        max_chars,
    )
    _log_selected_chunks(
        store_label=store_label,
        indexed=indexed,
        selected_entries=selected_entries,
        id_to_name=id_to_name,
        truncated_last=truncated_last,
    )
    return (parts, metrics)

def _log_selected_chunks(
    *,
    store_label: str,
    indexed: List[Tuple[int, Optional[int], Tuple[str, float, Optional[int], Optional[int]]]],
    selected_entries: List[Optional[str]],
    id_to_name: Dict[int, str],
    truncated_last: bool,
) -> None:
    """Поимённо: какие чанки ушли в промпт, а какие не поместились.

    Счётчиков ```[RAG/fragments]``` не хватает, чтобы разобрать конкретный ответ:
    они говорят «попало 12 из 17», но не какие именно. Здесь видно каждый
    кандидат, его релевантность и попал ли он в CONTEXT — то есть на что
    модель реально могла опираться.
    """
    if not logger.isEnabledFor(10) or not indexed:  # DEBUG
        return
    last_selected = max(
        (i for i, entry in enumerate(selected_entries) if entry is not None),
        default=-1,
    )
    lines = []
    for idx, (num, d_id, row) in enumerate(indexed):
        try:
            content, score, *doc_id, chunk_idx = row
        except (TypeError, ValueError):
            continue
        used = selected_entries[idx] is not None
        mark = "✓" if used else "✗"
        if used and truncated_last and idx == last_selected:
            mark = "▲"  # попал, но обрезан по бюджету
        title = id_to_name.get(d_id, f"doc*{d_id}") if d_id is not None else "?"
        preview = " ".join(str(content or "").split())[:80]
        # score — в шкале отработавшей стратегии, cosine — абсолютная близость.
        # Рядом видно и то, и другое: иначе по логу не понять, был ли чанк
        # действительно похож на запрос или просто оказался высоко по рангу.
        cos = getattr(row, "cosine", None)
        cos_text = "cos=н/д  " if cos is None else f"cos={float(cos):.4f}"
        lines.append(
            f"{mark} фрагмент {num:>2}  score={float(score or 0):.4f}"
            f"{cos_text}чанк {chunk_idx}  «{title}»  {preview}…"
        )
    logger.debug(
        "[RAG/выбор] store=%s: что ушло в CONTEXT (✓ целиком, ▲ обрезан, ✗ не поместился):\n%s",
        store_label,
        "\n".join(lines),
    )


async def fetch_rag_store_counts(
    rag_client: Any,
    *,
    project_id: Optional[str],
    use_kb_rag: bool,
    use_agent_scoped_kb: bool,
    agent_kb_doc_ids: Optional[List[Any]],
    use_memory_library_rag: bool,
) -> Dict[str, int]:
    """Число документов по хранилищам (для решения, ожидались ли ответы из корпуса)."""
    out: Dict[str, int] = {"project": 0, "kb": 0, "memory": 0, "agent_kb": 0}
    if not rag_client:
        return out
    if project_id:
        try:
            docs = await rag_client.project_rag_list_documents(project_id)
            out["project"] = len(docs) if isinstance(docs, list) else 0
        except Exception:
            logger.exception("project_rag_list_documents")
    kb_list: List[dict] = []
    if use_agent_scoped_kb:
        try:
            kb_list = await rag_client.kb_list_documents()
            if not isinstance(kb_list, list):
                kb_list = []
            out["kb"] = len(kb_list)
        except Exception:
            logger.exception("kb_list_documents")
    if use_agent_scoped_kb and agent_kb_doc_ids and kb_list:
        want = {int(x) for x in agent_kb_doc_ids if str(x).isdigit() or isinstance(x, int)}
        n = 0
        for d in kb_list:
            try:
                if int(d.get("id", -1)) in want:
                    n += 1
            except (TypeError, ValueError):
                continue
        out["agent_kb"] = n
    if use_memory_library_rag:
        try:
            docs = await rag_client.memory_rag_list_documents()
            out["memory"] = len(docs) if isinstance(docs, list) else 0
        except Exception:
            logger.exception("memory_rag_list_documents")
    return out


async def maybe_rag_no_evidence_message(
    rag_client: Any,
    *,
    block_when_no_evidence: bool,
    context_added: bool,
    project_id: Optional[str],
    use_kb_rag: bool,
    use_memory_library_rag: bool,
    use_agent_scoped_kb: bool,
    agent_kb_doc_ids: Optional[List[Any]],
) -> Optional[str]:
    """
    Если включён блок и в промпт не попал ни один фрагмент, но при этом был непустой
    корпус в задействованных хранилищах (project / kb / memory) — возвращает готовый текст
    ответа без LLM. Global store больше не учитывается.
    """
    if not block_when_no_evidence or context_added or (not rag_client):
        return None
    counts = await fetch_rag_store_counts(
        rag_client,
        project_id=project_id,
        use_kb_rag=use_kb_rag,
        use_agent_scoped_kb=use_agent_scoped_kb,
        agent_kb_doc_ids=agent_kb_doc_ids,
        use_memory_library_rag=use_memory_library_rag,
    )
    doc_backed = (
        bool(project_id and counts["project"] > 0)
        or (use_agent_scoped_kb and counts.get("agent_kb", 0) > 0)
        or (use_memory_library_rag and counts["memory"] > 0)
    )
    if not doc_backed:
        return None
    logger.info(
        "[RAG-NO-EVIDENCE] Блок ответа без опоры: контекст пуст при непустом корпусе. "
        "counts=%s project_id=%s use_kb_rag=%s use_agent_scoped_kb=%s "
        "use_memory_library_rag=%s",
        counts,
        project_id,
        use_kb_rag,
        use_agent_scoped_kb,
        use_memory_library_rag,
    )
    return RAG_NO_RELEVANT_CONTEXT_MESSAGE

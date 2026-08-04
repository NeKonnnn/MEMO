"""
app/services/hierarchical_indexing.py — переиспользуемая иерархическая индексация.
Один помощник для memory / project / kb: строит многоуровневую иерархию документа
(DocumentSummarizer) и раскладывает её в векторную таблицу стора
(OptimizedDocumentIndex). LLM для Level-2 summary — строго через backend
(app.services.llm_chat → POST backend /api/internal/rag/llm, Задача 3).
Машинерия store-agnostic: работает с любым vector_repo (create_vectors_batch)
и rag_client (embed / embed_single).
"""

from __future__ import annotations
from typing import Any, Optional
from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.hierarchical import DocumentSummarizer, OptimizedDocumentIndex

logger = get_logger(__name__)

# Backend отдаёт HTTP 200 и с текстом ошибки в теле: ask_agent при сбое
# возвращает человекочитаемое сообщение, а не исключение. Такой текст нельзя
# класть в индекс — он станет содержимым summary-чанка и будет всплывать
# в поиске. 01.08 так и вышло: десятки чанков «Ошибка LLM (HTTP 422)».
# Проверка дублирует такую же на стороне backend намеренно: сервисы
# выкатываются по отдельности, и любой из них может оказаться старой версии.
_LLM_ERROR_MARKERS = (
    "ошибка llm (http",
    "не удалось получить ответ от модели",
    "ошибка при обращении к модели",
    "сервис llm недоступен",
    "модель не загружена на стороне провайдера",
    "запрос не помещается в контекстное окно модели",
)

def _looks_like_llm_error(text: str) -> bool:
    s = str(text or "").strip().lower()
    return bool(s) and any(m in s[:200] for m in _LLM_ERROR_MARKERS)

async def _summarize_via_backend(prompt: str) -> str:
    """LLM-суммаризация через backend. При сбое — пустая строка (fallback внутри summarizer)."""
    from app.services import llm_chat

    try:
        result = await llm_chat.chat(
            prompt,
            purpose="summarize",
            temperature=0.3,
            max_tokens=2000,
        )
    except Exception as e:
        logger.warning("[hierarchical] LLM summary не удалась: %s", e)
        return ""
    if _looks_like_llm_error(result):
        logger.warning(
            "[hierarchical] backend вернул текст ошибки вместо summary — "
            "в индекс не пишем: %s",
            str(result)[:200],
        )
        return ""
    return result

async def index_document_hierarchically(
    text: str,
    doc_id: int,
    *,
    filename: str,
    vector_repo: Any,
    rag_client: Any,
    chunk_size: Optional[int] = None,
    chunk_overlap: Optional[int] = None,
    model: Optional[str] = None,
) -> int:
    """
    Иерархически проиндексировать УЖЕ СОЗДАННЫЙ документ (doc_id) в вектора стора.
    Документ в БД должен быть создан заранее (content=text сохранён вызывающим кодом).
    Возвращает число level-0 чанков. Кидает исключение при ошибке индексации —
    вызывающий код решает, удалять ли документ.
    """
    cfg = get_settings().rag
    cs = max(200, int(chunk_size)) if chunk_size else cfg.hierarchical_chunk_size
    co = (
        max(0, int(chunk_overlap))
        if chunk_overlap is not None
        else cfg.hierarchical_chunk_overlap
    )
    if co >= cs:
        co = max(0, cs // 4)
    summarizer = DocumentSummarizer(
        llm_function=_summarize_via_backend,
        max_chunk_size=cs,
        chunk_overlap=co,
        intermediate_summary_chunks=cfg.intermediate_summary_chunks,
    )
    hierarchical_doc = await summarizer.create_hierarchical_summary_async(
        text,
        filename,
        create_full_summary=bool(cfg.create_full_summary_via_llm),
    )
    optimized = OptimizedDocumentIndex(rag_client, vector_repo, model=model)
    ok = await optimized.index_document_hierarchical_async(hierarchical_doc, doc_id)
    if not ok:
        raise RuntimeError("иерархическая индексация не сохранила вектора")
    count = int(hierarchical_doc["metadata"]["total_chunks"])
    logger.info(
        "[hierarchical] doc_id=%s '%s': level-0 чанков=%s (+ summary L1/L2)",
        doc_id,
        filename,
        count,
    )
    return count
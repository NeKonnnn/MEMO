"""
Настройки Memory RAG (Библиотека / «Открыть базу данных») — только из env/ConfigMap.

Стратегия поиска (hybrid/vector/…) приходит из UI/чата и сюда не входит.
Project/Agent RAG используют персональные настройки пользователя (Postgres).
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Tuple

from backend.settings.logging import get_logger

logger = get_logger(__name__)

_VALID_CHUNKING = {"hierarchical", "fixed", "markdown", "separators", "semantic", "universal"}


def get_memory_embedding_fields() -> Dict[str, Any]:
    """Модель эмбеддингов Библиотеки — RAG_MEMORY_EMBEDDING_MODEL.

    Формат пути тот же, что у персональных настроек: ```local/<имя>```,
    ```corsur/<id>```, ```phoenix/<id>``` или ```phoenix_embeddings/<id>```.
    Пусто — кластерная модель svc-rag (поведение до этой правки).

    Размерность отдельной переменной не требует: она берётся из самой модели
    (```resolve_profile``` в svc-rag), а таблица подбирается по ней — как у KB
    и проектов после фазы B2b.
    """
    from backend.services.user_rag_settings import embedding_fields_from_path

    return embedding_fields_from_path(os.getenv("RAG_MEMORY_EMBEDDING_MODEL"))

def get_memory_reranker_fields() -> Dict[str, Any]:
    """Реранкер Библиотеки — RAG_MEMORY_RERANKER_MODEL. Формат пути тот же."""
    from backend.services.user_rag_settings import reranker_fields_from_path

    return reranker_fields_from_path(os.getenv("RAG_MEMORY_RERANKER_MODEL"))

def _env_bool(name: str, default: bool) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    logger.warning("%s=%r не bool — используем default=%s", name, os.getenv(name), default)
    return default


def _env_int(name: str, default: int, *, lo: int, hi: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return max(lo, min(default, hi))
    try:
        return max(lo, min(int(raw), hi))
    except ValueError:
        logger.warning("%s=%r не число — default=%s", name, raw, default)
        return max(lo, min(default, hi))


def _env_float(name: str, default: float, *, lo: float, hi: float) -> float:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return max(lo, min(default, hi))
    try:
        return max(lo, min(float(raw), hi))
    except ValueError:
        logger.warning("%s=%r не число — default=%s", name, raw, default)
        return max(lo, min(default, hi))


def get_memory_chunk_index_params() -> Dict[str, Any]:
    """Чанкинг Memory: RAG_MEMORY_* (ConfigMap svc-rag / backend)."""
    strategy = (os.getenv("RAG_MEMORY_CHUNKING_STRATEGY") or "universal").strip().lower()
    if strategy not in _VALID_CHUNKING:
        strategy = "universal"
    # Фоллбек на общие RAG_CHUNK_* только если Memory-специфичные не заданы
    size_default = _env_int("RAG_CHUNK_SIZE", 1000, lo=200, hi=8000)
    overlap_default = _env_int("RAG_CHUNK_OVERLAP", 200, lo=0, hi=2000)
    return {
        "chunk_size": _env_int("RAG_MEMORY_CHUNK_SIZE", size_default, lo=200, hi=8000),
        "chunk_overlap": _env_int("RAG_MEMORY_CHUNK_OVERLAP", overlap_default, lo=0, hi=2000),
        "chunking_strategy": strategy,
    }


def get_memory_rag_chat_top_k() -> int:
    """Сколько чанков запрашивать при поиске по Библиотеке."""
    fallback = _env_int("RAG_CHAT_TOP_K", 12, lo=1, hi=64)
    return _env_int("RAG_MEMORY_CHAT_TOP_K", fallback, lo=1, hi=64)


def get_memory_rag_retrieval_settings() -> Dict[str, Any]:
    """Retrieval-настройки Memory (всё кроме strategy поиска)."""
    rr_fallback = _env_bool("RAG_USE_RERANKING", True)
    rtn_fallback = _env_int("RAG_RERANK_TOP_N", 12, lo=1, hi=64)
    return {
        "rag_query_fix_typos": _env_bool("RAG_MEMORY_QUERY_FIX_TYPOS", False),
        "rag_multi_query_enabled": _env_bool("RAG_MEMORY_MULTI_QUERY_ENABLED", False),
        "rag_hyde_enabled": _env_bool("RAG_MEMORY_HYDE_ENABLED", False),
        "rag_reranking_enabled": _env_bool("RAG_MEMORY_RERANKING_ENABLED", rr_fallback),
        "rag_rerank_top_n": _env_int("RAG_MEMORY_RERANK_TOP_N", rtn_fallback, lo=1, hi=64),
        "rag_similarity_threshold": get_memory_similarity_threshold(),
        "rag_chat_top_k": get_memory_rag_chat_top_k(),
        "rag_system_prompt": get_memory_system_prompt(),
    }


def get_memory_similarity_threshold() -> float:
    """Порог similarity Библиотеки: RAG_MEMORY_SIMILARITY_THRESHOLD (ConfigMap).

    Фоллбек: RAG_MIN_SIMILARITY. Шкала 0..1 (как cosine).
    """
    return _env_float(
        "RAG_MEMORY_SIMILARITY_THRESHOLD",
        _env_float("RAG_MIN_SIMILARITY", 0.0, lo=0.0, hi=1.0),
        lo=0.0,
        hi=1.0,
    )


def get_memory_system_prompt() -> str:
    """Системный промпт Memory RAG из env/ConfigMap: RAG_MEMORY_SYSTEM_PROMPT.

    Пусто — применяются мягкие SOFT_CONTEXT_RULES (без принудительного «Не знаю»).
    Задайте в ConfigMap backend, например:
      RAG_MEMORY_SYSTEM_PROMPT: 'Используй только CONTEXT. Если ответа нет — скажи «Не знаю».'
    """
    return (os.getenv("RAG_MEMORY_SYSTEM_PROMPT") or "").strip()


def filter_hits_by_memory_similarity(
    hits: Optional[List[Tuple[str, float, Optional[int], Optional[int]]]],
) -> List[Tuple[str, float, Optional[int], Optional[int]]]:
    """Отфильтровать hits Memory по RAG_MEMORY_SIMILARITY_THRESHOLD."""
    if not hits:
        return []
    min_sim = get_memory_similarity_threshold()
    if min_sim <= 0.0:
        return list(hits)
    out: List[Tuple[str, float, Optional[int], Optional[int]]] = []
    for h in hits:
        try:
            if float(h[1]) >= min_sim:
                out.append(h)
        except (TypeError, ValueError, IndexError):
            continue
    return out

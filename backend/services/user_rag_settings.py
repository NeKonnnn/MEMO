"""
Персональные RAG-настройки пользователя.

Глобальный settings.json / app_state — только seed/defaults.
Чанкинг/модели/top_k/rerank/strategy для project + agent RAG — PostgreSQL
user_llm_settings.rag_settings. На время обработки чата настройки
прокидываются через ContextVar (см. bind_user_rag_runtime).
"""

from __future__ import annotations

import os
from contextvars import ContextVar, Token
from copy import deepcopy
from typing import Any, Dict, Optional

from backend.settings.logging import get_logger

logger = get_logger(__name__)

_RAG_SETTING_KEYS = (
    "rag_strategy",
    "rag_memory_strategy",
    "agentic_rag_enabled",
    "agentic_max_iterations",
    "rag_query_fix_typos",
    "rag_multi_query_enabled",
    "rag_hyde_enabled",
    "rag_chat_top_k",
    "rag_chunking_strategy",
    "rag_chunk_size",
    "rag_chunk_overlap",
    "rag_similarity_threshold",
    "rag_reranking_enabled",
    "rag_rerank_top_n",
    "rag_system_prompt",
    "rag_embedding_model_path",
    "rag_reranker_model_path",
)

# Персональные настройки текущего запроса чата/поиска (не глобальный app_state).
_user_rag_runtime: ContextVar[Optional[Dict[str, Any]]] = ContextVar(
    "user_rag_runtime", default=None
)
_user_rag_runtime_raw: ContextVar[Optional[Dict[str, Any]]] = ContextVar(
    "user_rag_runtime_raw", default=None
)


def _defaults_from_app_state() -> Dict[str, Any]:
    try:
        from backend import app_state as state

        return {
            "rag_strategy": str(getattr(state, "current_rag_strategy", "auto") or "auto"),
            "rag_memory_strategy": str(
                getattr(state, "rag_memory_strategy", "")
                or getattr(state, "current_rag_strategy", "auto")
                or "auto"
            ),
            "agentic_rag_enabled": bool(getattr(state, "agentic_rag_enabled", True)),
            "agentic_max_iterations": int(getattr(state, "agentic_max_iterations", 2) or 2),
            "rag_query_fix_typos": bool(getattr(state, "rag_query_fix_typos", False)),
            "rag_multi_query_enabled": bool(getattr(state, "rag_multi_query_enabled", False)),
            "rag_hyde_enabled": bool(getattr(state, "rag_hyde_enabled", False)),
            "rag_chat_top_k": int(getattr(state, "rag_chat_top_k", 12) or 12),
            "rag_chunking_strategy": str(getattr(state, "rag_chunking_strategy", "hierarchical") or "hierarchical"),
            "rag_chunk_size": int(getattr(state, "rag_chunk_size", 1000) or 1000),
            "rag_chunk_overlap": int(getattr(state, "rag_chunk_overlap", 200) or 200),
            "rag_similarity_threshold": float(getattr(state, "rag_similarity_threshold", 0.0) or 0.0),
            "rag_reranking_enabled": bool(getattr(state, "rag_reranking_enabled", True)),
            "rag_rerank_top_n": int(getattr(state, "rag_rerank_top_n", 12) or 12),
            "rag_system_prompt": str(
                getattr(
                    state,
                    "rag_system_prompt",
                    "Используй только предоставленный контекст. Если ответа нет в тексте, скажи «Не знаю». Не придумывай факты.",
                )
                or ""
            ),
            "rag_embedding_model_path": str(getattr(state, "rag_embedding_model_path", "") or ""),
            "rag_reranker_model_path": str(getattr(state, "rag_reranker_model_path", "") or ""),
        }
    except Exception:
        logger.exception("user_rag_settings: defaults from app_state failed")
        return {
            "rag_strategy": "auto",
            "rag_memory_strategy": "auto",
            "agentic_rag_enabled": True,
            "agentic_max_iterations": 2,
            "rag_query_fix_typos": False,
            "rag_multi_query_enabled": False,
            "rag_hyde_enabled": False,
            "rag_chat_top_k": 12,
            "rag_chunking_strategy": "hierarchical",
            "rag_chunk_size": 1000,
            "rag_chunk_overlap": 200,
            "rag_similarity_threshold": 0.0,
            "rag_reranking_enabled": True,
            "rag_rerank_top_n": 12,
            "rag_system_prompt": (
                "Используй только предоставленный контекст. Если ответа нет в тексте, скажи «Не знаю». Не придумывай факты."
            ),
            "rag_embedding_model_path": "",
            "rag_reranker_model_path": "",
        }


SCOPES = ("project", "agent")
DEFAULT_SCOPE = "project"
_SCOPES_FIELD = "scopes"
_SCOPED_KEYS = (
    "rag_strategy",
    "rag_chunking_strategy",
    "rag_chunk_size",
    "rag_chunk_overlap",
    "rag_similarity_threshold",
    "rag_reranking_enabled",
    "rag_rerank_top_n",
    "rag_system_prompt",
    "rag_embedding_model_path",
    "rag_reranker_model_path",
    "rag_chat_top_k",
)
_GLOBAL_KEYS = tuple(k for k in _RAG_SETTING_KEYS if k not in _SCOPED_KEYS)


def normalize_scope(raw: Optional[str]) -> str:
    s = (raw or "").strip().lower()
    return s if s in SCOPES else DEFAULT_SCOPE


def _merge(stored: Optional[Dict[str, Any]], scope: Optional[str] = None) -> Dict[str, Any]:
    merged = _defaults_from_app_state()
    if not isinstance(stored, dict):
        return merged

    sc = normalize_scope(scope)
    for key in _GLOBAL_KEYS:
        if key in stored and stored[key] is not None:
            merged[key] = stored[key]

    for key in _SCOPED_KEYS:
        if key in stored and stored[key] is not None:
            merged[key] = stored[key]

    scoped = (stored.get(_SCOPES_FIELD) or {}).get(sc)
    if isinstance(scoped, dict):
        for key in _SCOPED_KEYS:
            if key in scoped and scoped[key] is not None:
                merged[key] = scoped[key]
    return merged


def _get_repo():
    try:
        from backend.database.init_db import get_user_settings_repository

        return get_user_settings_repository()
    except Exception:
        logger.debug("user rag settings repository недоступен", exc_info=True)
        return None


async def get_user_rag_settings(user_id: Optional[str], scope: Optional[str] = None) -> Dict[str, Any]:
    if not user_id:
        return _defaults_from_app_state()
    repo = _get_repo()
    if repo is None:
        return _defaults_from_app_state()
    row = await repo.get(user_id)
    if not row:
        return _defaults_from_app_state()
    return _merge(row.get("rag_settings"), scope)


async def raw_user_rag_settings(user_id: Optional[str]) -> Dict[str, Any]:
    uid = (user_id or "").strip()
    if not uid:
        return {}
    repo = _get_repo()
    if repo is None:
        return {}
    row = await repo.get(uid)
    raw = (row or {}).get("rag_settings")
    return dict(raw) if isinstance(raw, dict) else {}


async def save_user_rag_settings(
    user_id: str, updates: Dict[str, Any], scope: Optional[str] = None
) -> Dict[str, Any]:
    """Частичное обновление персональных RAG-настроек. Возвращает полный merged snapshot."""
    uid = (user_id or "").strip()
    if not uid:
        raise ValueError("user_id обязателен")
    sc = normalize_scope(scope)
    repo = _get_repo()
    row = await repo.get(uid) if repo is not None else None
    raw = dict((row or {}).get("rag_settings") or {})
    scopes = dict(raw.get(_SCOPES_FIELD) or {})

    for other in SCOPES:
        if other in scopes:
            continue
        legacy = {k: raw[k] for k in _SCOPED_KEYS if raw.get(k) is not None}
        if legacy:
            scopes[other] = dict(legacy)

    scoped_now = dict(scopes.get(sc) or {})
    if repo is None:
        logger.warning("user_rag_settings: repo недоступен — сохранение только в памяти ответа")
        tmp = dict(raw)
        for key in _GLOBAL_KEYS:
            if key in updates and updates[key] is not None:
                tmp[key] = updates[key]
        for key in _SCOPED_KEYS:
            if key in updates and updates[key] is not None:
                scoped_now[key] = updates[key]
        scopes[sc] = scoped_now
        tmp[_SCOPES_FIELD] = scopes
        return _merge(tmp, sc)
    for key in _GLOBAL_KEYS:
        if key in updates and updates[key] is not None:
            raw[key] = updates[key]
    for key in _SCOPED_KEYS:
        if key in updates and updates[key] is not None:
            scoped_now[key] = updates[key]
    scopes[sc] = scoped_now
    raw[_SCOPES_FIELD] = scopes
    for key in _SCOPED_KEYS:
        raw.pop(key, None)
    await repo.upsert(uid, rag_settings=raw)
    return _merge(raw, sc)


def chunk_params_from_rag_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    try:
        size = int(settings.get("rag_chunk_size") or 1000)
    except (TypeError, ValueError):
        size = 1000
    try:
        overlap = int(settings.get("rag_chunk_overlap") or 200)
    except (TypeError, ValueError):
        overlap = 200
    strategy = str(settings.get("rag_chunking_strategy") or "hierarchical").strip().lower()
    if strategy not in {"hierarchical", "fixed", "markdown", "separators", "semantic", "universal"}:
        strategy = "hierarchical"
    return {
        "chunk_size": max(200, min(size, 8000)),
        "chunk_overlap": max(0, min(overlap, 2000)),
        "chunking_strategy": strategy,
    }


def settings_response_dict(settings: Dict[str, Any]) -> Dict[str, Any]:
    """Формат ответа /api/rag/settings (как раньше из app_state)."""
    strategy = str(settings.get("rag_strategy") or "auto")
    return {
        "strategy": strategy,
        "rag_memory_strategy": str(settings.get("rag_memory_strategy") or strategy or "auto"),
        "applied_method": strategy,
        "method_description": {
            "auto": "Автоматический выбор стратегии.",
            "hierarchical": "Иерархический поиск по суммаризациям.",
            "hybrid": "Гибридный поиск: вектор + BM25 (weighted RRF по рангам).",
            "vector": "Чистый поиск по cosine distance без изменения порядка результатов.",
            "lexical": "Лексический поиск BM25 (без семантического расширения).",
            "raw_cosine": "Сырой cosine-поиск (без постобработки).",
            "graph": "Графовый RAG: расширение по связям между чанками.",
        }.get(strategy, ""),
        "agentic_rag_enabled": bool(settings.get("agentic_rag_enabled", True)),
        "agentic_max_iterations": int(settings.get("agentic_max_iterations") or 2),
        "rag_query_fix_typos": bool(settings.get("rag_query_fix_typos", False)),
        "rag_multi_query_enabled": bool(settings.get("rag_multi_query_enabled", False)),
        "rag_hyde_enabled": bool(settings.get("rag_hyde_enabled", False)),
        "rag_chat_top_k": int(settings.get("rag_chat_top_k") or 12),
        "rag_chunking_strategy": str(settings.get("rag_chunking_strategy") or "hierarchical"),
        "rag_chunk_size": int(settings.get("rag_chunk_size") or 1000),
        "rag_chunk_overlap": int(settings.get("rag_chunk_overlap") or 200),
        "rag_similarity_threshold": float(settings.get("rag_similarity_threshold") or 0.0),
        "rag_reranking_enabled": bool(settings.get("rag_reranking_enabled", True)),
        "rag_rerank_top_n": int(settings.get("rag_rerank_top_n") or 12),
        "rag_system_prompt": str(settings.get("rag_system_prompt") or ""),
        "rag_embedding_model_path": str(settings.get("rag_embedding_model_path") or ""),
        "rag_reranker_model_path": str(settings.get("rag_reranker_model_path") or ""),
    }


def default_rag_settings_snapshot() -> Dict[str, Any]:
    return deepcopy(_defaults_from_app_state())


def bind_user_rag_runtime(
    settings: Optional[Dict[str, Any]], raw: Optional[Dict[str, Any]] = None
) -> Token:
    """Привязать персональные RAG-настройки к текущему async-контексту (чат/поиск)."""
    _user_rag_runtime_raw.set(dict(raw) if isinstance(raw, dict) else None)
    payload = dict(settings) if isinstance(settings, dict) else None
    return _user_rag_runtime.set(payload)


def reset_user_rag_runtime(token: Token) -> None:
    _user_rag_runtime.reset(token)
    _user_rag_runtime_raw.set(None)


def get_runtime_rag_settings(scope: Optional[str] = None) -> Dict[str, Any]:
    """Настройки текущего запроса или seed/defaults, если контекст не задан."""
    if scope is not None:
        raw = _user_rag_runtime_raw.get()
        if isinstance(raw, dict) and raw:
            return _merge(raw, scope)
    cur = _user_rag_runtime.get()
    if isinstance(cur, dict) and cur:
        return cur
    return _defaults_from_app_state()


def runtime_rag_top_k(scope: Optional[str] = None) -> int:
    try:
        v = int(get_runtime_rag_settings(scope).get("rag_chat_top_k") or 12)
    except (TypeError, ValueError):
        v = 12
    return max(1, min(v, 64))


def runtime_rag_strategy(scope: Optional[str] = None) -> str:
    return str(get_runtime_rag_settings(scope).get("rag_strategy") or "auto")


def runtime_memory_strategy() -> str:
    settings = get_runtime_rag_settings(DEFAULT_SCOPE)
    return str(settings.get("rag_memory_strategy") or settings.get("rag_strategy") or "auto")


def runtime_rag_system_prompt(scope: Optional[str] = None) -> str:
    return str(get_runtime_rag_settings(scope).get("rag_system_prompt") or "")


def runtime_agentic_rag_enabled() -> bool:
    return bool(get_runtime_rag_settings().get("agentic_rag_enabled", True))


def runtime_agentic_max_iterations() -> int:
    try:
        v = int(get_runtime_rag_settings().get("agentic_max_iterations") or 2)
    except (TypeError, ValueError):
        v = 2
    return max(1, min(v, 5))


def runtime_rag_similarity_threshold(scope: Optional[str] = None) -> float:
    try:
        v = float(get_runtime_rag_settings(scope).get("rag_similarity_threshold") or 0.0)
    except (TypeError, ValueError):
        v = 0.0
    return max(0.0, min(v, 1.0))

def embedding_fields_from_path(model_path: Optional[str]) -> Dict[str, Any]:
    """Путь модели из настроек → поля запроса к svc-rag.

    'local/FRIDA'  → {"embedding_model": "FRIDA", "embedding_provider": "native"}
    'phoenix/<id>' → {"embedding_model": "<id>", "embedding_provider": "PHOENIX"}
    ''             → {} — модель не выбрана, svc-rag берёт кластерную (как раньше)

    Пустой словарь — это ВАЖНО: пользователь без выбора должен ходить ровно тем
    же путём, что до мультимодельности.
    """
    p = (model_path or "").strip()
    if not p:
        return {}
    if p.lower().startswith("phoenix/"):
        provider = (
            os.getenv("RAG_PHOENIX_PROVIDER_ID", "PHOENIX").strip() or "PHOENIX"
        )
        model = p.split("/", 1)[1].strip()
    else:
        provider = "native"
        model = p.split("/", 1)[1].strip() if "/" in p else p
    if not model:
        return {}
    return {"embedding_model": model, "embedding_provider": provider}

def embedding_fields_from_rag_settings(
    settings: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    return embedding_fields_from_path(
        (settings or {}).get("rag_embedding_model_path")
    )

def runtime_embedding_fields(scope: Optional[str] = None) -> Dict[str, Any]:
    """Модель ТЕКУЩЕГО запроса чата/поиска (ContextVar), если выбрана."""
    return embedding_fields_from_rag_settings(get_runtime_rag_settings(scope))

def reranker_fields_from_path(model_path: Optional[str]) -> Dict[str, Any]:
    """Путь реранкера из настроек -> поля запроса к svc-rag.

    Разбор пути тот же, что у эмбеддера, но ключи другие: реранкер выбирается
    независимо (можно эмбеддить нативно, а реранкать в Phoenix).
    """
    fields = embedding_fields_from_path(model_path)
    if not fields:
        return {}
    return {
        "reranker_model": fields["embedding_model"],
        "reranker_provider": fields["embedding_provider"],
    }

def reranker_fields_from_rag_settings(
    settings: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    return reranker_fields_from_path(
        (settings or {}).get("rag_reranker_model_path")
    )

def runtime_reranker_fields(scope: Optional[str] = None) -> Dict[str, Any]:
    """Реранкер ТЕКУЩЕГО запроса (ContextVar), если выбран."""
    return reranker_fields_from_rag_settings(get_runtime_rag_settings(scope))

async def embedding_fields_for_user(
    user_id: Optional[str], scope: Optional[str] = None
) -> Dict[str, Any]:
    """Модель конкретного пользователя — для фона и загрузок (ContextVar нет/чужой)."""
    if not user_id:
        return {}
    return embedding_fields_from_rag_settings(await get_user_rag_settings(user_id, scope))
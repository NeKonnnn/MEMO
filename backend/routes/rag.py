"""
routes/rag.py - настройки RAG, База Знаний (KB), библиотека памяти (memory-rag)
"""

import os
from typing import Annotated, Optional
import asyncio
import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

import backend.app_state as state
from backend.app_state import (
    minio_client,
    rag_client,
    rag_models_client,
    settings,
    get_library_chunk_index_params,
    get_rag_chunk_index_params,
)
from backend.auth.jwt_handler import get_current_user
from backend.rag_query.semantic_cache import bump_rag_semantic_cache
from backend.schemas import RAGSettings, RagModelSelectRequest
from backend.services.user_rag_settings import (
    chunk_params_from_rag_settings,
    default_rag_settings_snapshot,
    get_user_rag_settings,
    save_user_rag_settings,
    settings_response_dict,
)
from backend.settings.logging import get_logger
from backend.settings.logging.errors import logged_suppress
from backend.settings.service_toggles import require_service
from backend.realtime.rag_evidence import build_reindex_status_message
from backend.storage.rag_pvc import (
    RAG_PVC_BUCKET_MARKER,
    RAG_PVC_DIR_ENV,
    delete_rag_pvc_file,
    is_rag_pvc_bucket,
    save_rag_bytes_to_pvc,
    use_rag_pvc,
)

logger = get_logger(__name__)


def _model_row_from_path(model_path: str, kind: str) -> dict:
    path = str(model_path or "").strip()
    name = path.split("/")[-1] if path else ""
    source = path.split("/")[0] if "/" in path else "local"
    return {
        "path": path,
        "name": name,
        "display_name": name,
        "source": source,
        "kind": kind,
    }


def _overlay_user_model_current(data: dict, user_rag: dict) -> dict:
    """В UI current — персональный выбор пользователя, не runtime кластера.

    Если у пользователя путь пуст — показываем cluster_default (ConfigMap на старте
    svc-rag-models), а не live current после чужого /models/select.
    """
    out = dict(data or {})
    cluster = dict(out.get("cluster_default") or out.get("current") or {})
    current = dict(cluster)
    saved_emb = str(user_rag.get("rag_embedding_model_path") or "").strip()
    saved_rer = str(user_rag.get("rag_reranker_model_path") or "").strip()
    if saved_emb:
        current["embedding"] = _model_row_from_path(saved_emb, "embedding")
    if saved_rer:
        current["reranker"] = _model_row_from_path(saved_rer, "reranker")
    out["current"] = current
    out["cluster_default"] = cluster
    return out


def _allowed_embedding_models() -> list:
    """Белый список эмбеддеров из ENV. Пусто = разрешены все (поведение по умолчанию)."""
    raw = (os.getenv("RAG_EMBEDDING_MODELS_ALLOWED", "") or "").replace(";", ",")
    return [m.strip().lower() for m in raw.split(",") if m.strip()]

async def _validate_local_model_path(model_type: str, model_path: str) -> None:
    data = await rag_models_client.list_models(model_type)
    rows = (data.get("models") or {}).get(model_type) or []
    paths = {str((r or {}).get("path") or "").strip() for r in rows}
    if model_path not in paths:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Модель {model_path!r} не найдена в каталоге. "
                "Доступны только папки из RAG_MODELS_DIR / ConfigMap RAG**_MODEL*."
            ),
        )
    # Гард по памяти: модель есть на диске, но её загрузка положит под моделей.
    # Проверяем ДО выбора — иначе падение случится в фоне, без сообщения пользователю.
    allowed = _allowed_embedding_models()
    if model_type == "embedding" and allowed:
        name = model_path.split("/")[-1].strip()
        if name.lower() not in allowed:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Модель {name!r} сейчас недоступна для выбора: она не помещается "
                    f"в память сервиса моделей. Доступны: {', '.join(sorted(allowed))}."
                ),
            )

def _rag_upload_username(current_user: dict) -> str:
    return current_user.get("username") or current_user.get("user_id") or "anonymous"


def _delete_rag_source_file(object_name: Optional[str], bucket: Optional[str]) -> None:
    """Удаляет исходник из PVC или MinIO по metadata документа."""
    if not object_name or not bucket:
        return
    if is_rag_pvc_bucket(bucket):
        delete_rag_pvc_file(object_name, bucket)
        return
    if minio_client:
        try:
            minio_client.delete_file(object_name, bucket_name=bucket)
        except Exception:
            logger.exception("MinIO delete RAG source object=%s bucket=%s", object_name, bucket)


router = APIRouter(tags=["rag"])
_VALID_STRATEGIES = {"auto", "hierarchical", "hybrid", "vector", "lexical", "raw_cosine", "graph"}
_VALID_CHUNKING_STRATEGIES = {"hierarchical", "fixed", "markdown", "separators", "semantic"}

# Кто сейчас в scoped-перечанковке (project/kb). Плашка у других пользователей не горит.
# Memory / cluster-reindex — отдельно (кластерный флаг).
_user_scoped_reindex_kb: set[str] = set()
_user_scoped_reindex_project: set[str] = set()
_cluster_reindex_active: bool = False
# Когда флаги подняли. svc-rag отвечает "started" ДО того, как возьмёт лок, —
# без форы статус погасил бы плашку в первую же секунду.
_reindex_flags_started_at: float = 0.0
REINDEX_FLAG_GRACE_SECONDS = 60.0

def _mark_reindex_started() -> None:
    global _reindex_flags_started_at
    import time

    _reindex_flags_started_at = time.monotonic()

def _reindex_grace_active() -> bool:
    import time

    return (time.monotonic() - _reindex_flags_started_at) < REINDEX_FLAG_GRACE_SECONDS


def _norm_uid(user_id: Optional[str]) -> str:
    return str(user_id or "").strip().lower()


def _mark_user_scoped_reindex(user_id: str, *, active: bool) -> None:
    uid = _norm_uid(user_id)
    if not uid:
        return
    if active:
        _user_scoped_reindex_kb.add(uid)
        _user_scoped_reindex_project.add(uid)
    else:
        _user_scoped_reindex_kb.discard(uid)
        _user_scoped_reindex_project.discard(uid)


def _is_upstream_httpx_timeout(exc: BaseException) -> bool:
    seen = set()
    cur = exc
    while cur is not None and id(cur) not in seen:
        seen.add(id(cur))
        if isinstance(cur, httpx.TimeoutException):
            return True
        cur = cur.__cause__
    return False


def _rag_settings_response_dict() -> dict:
    """Дефолты кластера (settings.json / env) — seed для новых пользователей."""
    return settings_response_dict(default_rag_settings_snapshot())


@router.get("/api/rag/settings")
async def get_rag_settings(current_user: Annotated[dict, Depends(get_current_user)]):
    """Персональные RAG-настройки (project + agent).

    Memory RAG (кроме стратегии поиска) — только ConfigMap/env SVC-RAG / SVC-RAG-MODELS.
    """
    user_id = str(current_user.get("user_id") or "").strip()
    settings_data = await get_user_rag_settings(user_id)
    return settings_response_dict(settings_data)


def _build_reindex_status_message(
    *,
    memory_reindexing: bool,
    project_reindexing: bool,
    kb_reindexing: bool,
) -> str:
    return build_reindex_status_message(
        memory_reindexing=memory_reindexing,
        project_reindexing=project_reindexing,
        kb_reindexing=kb_reindexing,
    )


async def _resolve_agent_has_kb_documents(agent_id: int, user_id: Optional[str]) -> bool:
    """Агент реально использует KB-RAG: file_search + id документов, существующих в сторе."""
    from backend.realtime.helpers import _resolve_agent_chat_params

    profile = await _resolve_agent_chat_params(agent_id, user_id)
    if not bool(profile.get("file_search_enabled")):
        return False
    kb_ids = profile.get("kb_document_ids") or []
    if not isinstance(kb_ids, list) or len(kb_ids) == 0:
        return False
    if not rag_client:
        return False
    try:
        rows = list(await rag_client.kb_list_documents() or [])
    except Exception:
        logger.warning("[RAG] kb_list_documents failed for reindex-status", exc_info=True)
        return len(kb_ids) > 0
    existing = {int(d.get("id")) for d in rows if d.get("id") is not None}
    return any(int(doc_id) in existing for doc_id in kb_ids)


async def _resolve_project_has_rag_documents(project_id: str) -> bool:
    if not rag_client or not project_id:
        return False
    try:
        docs = list(await rag_client.project_rag_list_documents(project_id) or [])
    except Exception:
        logger.warning("[RAG] project_rag_list_documents failed for reindex-status", exc_info=True)
        return False
    return len(docs) > 0


@router.get("/api/rag/reindex-status")
async def get_rag_reindex_status(
    current_user: Annotated[dict, Depends(get_current_user)],
    agent_id: Optional[int] = None,
    project_id: Optional[str] = None,
):
    """Агрегированный статус перечанковки RAG для UI (плашка и стоппер)."""
    empty_payload = {
        "memory": {"reindexing": False},
        "project": {"reindexing": False},
        "kb": {"reindexing": False},
        "any_reindexing": False,
        "agent_has_kb": False,
        "project_has_documents": False,
        "message": "",
    }
    if not rag_client:
        return empty_payload
    global _reindex_flags_started_at, _cluster_reindex_active
    global _user_scoped_reindex_kb, _user_scoped_reindex_project
    try:
        status = await rag_client.get_reindex_status()
    except Exception as exc:
        logger.warning("[RAG] reindex-status poll failed: %s", exc)
        return empty_payload

    # Источник истины о том, идёт ли работа, — локи svc-rag, а не наши флаги:
    # backend узнаёт только момент ПОСТАНОВКИ задачи, не её завершение.
    svc_busy = any(
        bool((status.get(key) or {}).get("reindexing"))
        for key in ("kb", "project", "memory")
    )
    if not svc_busy and not _reindex_grace_active():
        if _cluster_reindex_active:
            logger.info("[REINDEX] svc-rag освободился — снимаю кластерный флаг")
            _cluster_reindex_active = False
        if _user_scoped_reindex_kb or _user_scoped_reindex_project:
            logger.info("[REINDEX] svc-rag освободился — снимаю пер-юзерные флаги")
            _user_scoped_reindex_kb.clear()
            _user_scoped_reindex_project.clear()

    user_id = _norm_uid(current_user.get("user_id") if current_user else None)
    agent_has_kb = False
    if agent_id is not None:
        agent_has_kb = await _resolve_agent_has_kb_documents(agent_id, user_id or None)

    project_has_documents = False
    if project_id:
        project_has_documents = await _resolve_project_has_rag_documents(str(project_id).strip())

    # Memory — общий стор: флаг виден всем (ConfigMap / cluster).
    memory_flag = bool(status.get("memory", {}).get("reindexing")) or _cluster_reindex_active
    # Project/KB scoped: плашка только у пользователя, который запустил перечанковку
    # (или при полном cluster-reindex после смены dim).
    if _cluster_reindex_active:
        project_flag = bool(status.get("project", {}).get("reindexing"))
        kb_flag = bool(status.get("kb", {}).get("reindexing"))
    else:
        project_flag = bool(user_id and user_id in _user_scoped_reindex_project)
        kb_flag = bool(user_id and user_id in _user_scoped_reindex_kb)
    message = _build_reindex_status_message(
        memory_reindexing=memory_flag,
        project_reindexing=project_flag,
        kb_reindexing=kb_flag,
    )
    return {
        "memory": {"reindexing": memory_flag},
        "project": {"reindexing": project_flag},
        "kb": {"reindexing": kb_flag},
        "any_reindexing": memory_flag or project_flag or kb_flag,
        "agent_has_kb": agent_has_kb,
        "project_has_documents": project_has_documents,
        "message": message,
    }


@router.post("/api/rag/settings/reset")
async def reset_rag_settings(current_user: Annotated[dict, Depends(get_current_user)]):
    """Сброс персональных RAG-настроек пользователя к дефолтам кластера."""
    try:
        user_id = str(current_user.get("user_id") or "").strip()
        if not user_id:
            raise HTTPException(status_code=401, detail="Требуется авторизация")
        logger.debug("[RAG-CFG] сброс персональных RAG-настроек user=%s", user_id)
        defaults = default_rag_settings_snapshot()
        # UI-дефолты сброса (как раньше в reset)
        defaults.update(
            {
                "rag_strategy": "auto",
                "agentic_rag_enabled": True,
                "agentic_max_iterations": 2,
                "rag_query_fix_typos": False,
                "rag_multi_query_enabled": False,
                "rag_hyde_enabled": False,
                "rag_chat_top_k": 8,
                "rag_chunking_strategy": "hierarchical",
                "rag_chunk_size": 1000,
                "rag_chunk_overlap": 200,
                "rag_similarity_threshold": 0.0,
                "rag_reranking_enabled": True,
                "rag_rerank_top_n": 12,
                "rag_embedding_model_path": "",
                "rag_reranker_model_path": "",
                "rag_system_prompt": (
                    "Используй только предоставленный контекст. Если ответа нет в тексте, скажи «Не знаю». Не придумывай факты."
                ),
            }
        )
        merged = await save_user_rag_settings(user_id, defaults)
        bump_rag_semantic_cache()
        return {"message": "Настройки RAG сброшены", "success": True, **settings_response_dict(merged)}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка операции")
        raise HTTPException(status_code=500, detail=str(e)) from e


def _rechunk_on_settings_change() -> bool:
    v = os.getenv("RAG_RECHUNK_ON_SETTINGS_CHANGE", "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _reindex_on_model_change() -> bool:
    # Дефолт true: после смены embedding-модели вектора стёрты миграцией,
    # без реиндекса поиск мёртв до ручного перезалива
    v = os.getenv("RAG_REINDEX_ON_MODEL_CHANGE", "true").strip().lower()
    return v in ("1", "true", "yes", "on")


async def _collect_owner_agent_kb_document_ids(owner_user_id: str) -> list:
    """document_id из config агентов, где user — author (владелец)."""
    oid = (owner_user_id or "").strip().lower()
    if not oid:
        return []
    try:
        from backend.database.init_db import get_agent_repository
        from backend.database.postgresql.agent_models import AgentFilters

        repo = get_agent_repository()
        agents, _total = await repo.get_agents(
            AgentFilters(author_id=oid, author_only=True, limit=100, offset=0),
            user_id=oid,
        )
        out: list = []
        seen = set()
        for agent in agents or []:
            cfg = getattr(agent, "config", None) or {}
            if isinstance(cfg, str):
                import json

                try:
                    cfg = json.loads(cfg)
                except Exception:
                    cfg = {}
            if not isinstance(cfg, dict):
                continue
            for raw in cfg.get("kb_document_ids") or []:
                try:
                    doc_id = int(raw)
                except (TypeError, ValueError):
                    continue
                if doc_id not in seen:
                    seen.add(doc_id)
                    out.append(doc_id)
        return out
    except Exception:
        logger.exception("Не удалось собрать kb_document_ids владельца %s", oid)
        return []


async def _run_background_rechunk_for_user(user_id: str, chunk_params: dict) -> None:
    """Перечанковка только документов пользователя: project + agent KB (owner).

    Memory RAG не трогаем — нарезка Memory только из env SVC-RAG.
    """
    if not rag_client or not user_id:
        return
    cs = chunk_params.get("chunk_size")
    co = chunk_params.get("chunk_overlap")
    strat = chunk_params.get("chunking_strategy")
    oid = _norm_uid(user_id)
    agent_doc_ids = await _collect_owner_agent_kb_document_ids(oid)
    # Фон живёт вне запроса — ContextVar пуст, модель берём по user_id явно.
    from backend.services.user_rag_settings import embedding_fields_for_user

    emb = await embedding_fields_for_user(oid)
    logger.info(
        "[RECHUNK-USER] старт user=%s model=%s strategy=%s chunk_size=%s overlap=%s agent_docs=%s",
        oid,
        emb.get("embedding_model"),
        strat,
        cs,
        co,
        len(agent_doc_ids),
    )
    _mark_user_scoped_reindex(oid, active=True)
    _mark_reindex_started()
    try:
        try:
            kb_res = await rag_client.kb_reindex(
                chunk_size=cs,
                chunk_overlap=co,
                chunking_strategy=strat,
                owner_user_id=oid,
                document_ids=agent_doc_ids or None,
                **emb,
            )
            logger.info("[RECHUNK-USER] kb готово: %s", kb_res)
        except Exception:
            logger.exception("[RECHUNK-USER] kb ошибка")
        try:
            proj_res = await rag_client.project_rag_reindex_all(
                chunk_size=cs,
                chunk_overlap=co,
                chunking_strategy=strat,
                owner_user_id=oid,
                **emb,
            )   
            logger.info("[RECHUNK-USER] projects готово: %s", proj_res)
        except Exception:
            logger.exception("[RECHUNK-USER] projects ошибка")
        logger.info(
            "[RECHUNK-USER] задачи поставлены в svc-rag user=%s; "
            "флаг снимется по факту завершения",
            oid,
        )
    except Exception:
        # Ставить задачи не удалось — снимаем флаг сразу, ждать нечего.
        _mark_user_scoped_reindex(oid, active=False)
        raise


async def _run_background_reindex_after_model_change() -> None:
    """Кластерное восстановление после миграции dim (ConfigMap / reconcile).

    Memory тоже переиндексируется — вектора очищены TRUNCATE всей таблицы.
    """
    global _cluster_reindex_active
    if not rag_client:
        return
    params = get_rag_chunk_index_params()
    cs = params.get("chunk_size")
    co = params.get("chunk_overlap")
    strat = params.get("chunking_strategy")
    logger.info(
        "[REINDEX-CLUSTER] старт после миграции dim: strategy=%s size=%s overlap=%s",
        strat,
        cs,
        co,
    )
    _cluster_reindex_active = True
    _mark_reindex_started()
    try:
        from backend.services.memory_rag_env import get_memory_chunk_index_params

        mem = get_memory_chunk_index_params()
    except Exception:
        mem = {"chunk_size": cs, "chunk_overlap": co, "chunking_strategy": "universal"}
    for name, call, kwargs in (
        ("kb", rag_client.kb_reindex, {"chunk_size": cs, "chunk_overlap": co, "chunking_strategy": strat}),
        ("projects", rag_client.project_rag_reindex_all, {"chunk_size": cs, "chunk_overlap": co, "chunking_strategy": strat}),
        (
            "memory",
            rag_client.memory_rag_reindex,
            {
                "chunk_size": mem.get("chunk_size"),
                "chunk_overlap": mem.get("chunk_overlap"),
                "chunking_strategy": mem.get("chunking_strategy"),
            },
        ),
    ):
        try:
            res = await call(**kwargs)
            logger.info("[REINDEX-CLUSTER] %s готово: %s", name, res)
        except Exception:
            logger.exception("[REINDEX-CLUSTER] %s ошибка", name)
    logger.info(
        "[REINDEX-CLUSTER] задачи поставлены в svc-rag; "
        "флаг снимется по факту завершения"
    )


async def _run_background_reindex_for_user(user_id: str, chunk_params: dict) -> None:
    """Переиндексация project + agent KB только для пользователя (без Memory)."""
    await _run_background_rechunk_for_user(user_id, chunk_params)


@router.put("/api/rag/settings")
async def update_rag_settings(
    settings_data: RAGSettings,
    current_user: Annotated[dict, Depends(get_current_user)],
):
    """Обновить персональные RAG-настройки (project + agent).

    Memory RAG (кроме strategy) через UI не меняется.
    При смене чанкинга — перечанковка только документов текущего пользователя;
    для agent KB — только docs с owner_user_id = этот пользователь (владелец агента).
    """
    user_id = str(current_user.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Требуется авторизация")

    strat = settings_data.strategy
    if strat is not None and strat == "reranking":
        strat = "hybrid"
    if strat is not None and strat == "standard":
        strat = "vector"
    if strat is not None and strat == "lexical":
        strat = "lexical"
    if strat is not None and strat not in _VALID_STRATEGIES:
        raise HTTPException(status_code=400, detail=f"Недопустимая стратегия. Допустимые: {_VALID_STRATEGIES}")
    chunking = settings_data.rag_chunking_strategy
    if chunking is not None:
        chunking = str(chunking).strip().lower()
        if chunking not in _VALID_CHUNKING_STRATEGIES:
            raise HTTPException(
                status_code=400,
                detail=f"Недопустимая стратегия чанкования. Допустимые: {_VALID_CHUNKING_STRATEGIES}",
            )
    if (
        settings_data.strategy is None
        and settings_data.agentic_rag_enabled is None
        and (settings_data.agentic_max_iterations is None)
        and (settings_data.rag_query_fix_typos is None)
        and (settings_data.rag_multi_query_enabled is None)
        and (settings_data.rag_hyde_enabled is None)
        and (settings_data.rag_chat_top_k is None)
        and (settings_data.rag_chunking_strategy is None)
        and (settings_data.rag_chunk_size is None)
        and (settings_data.rag_chunk_overlap is None)
        and (settings_data.rag_similarity_threshold is None)
        and (settings_data.rag_reranking_enabled is None)
        and (settings_data.rag_rerank_top_n is None)
        and (settings_data.rag_system_prompt is None)
        and (settings_data.rag_embedding_model_path is None)
        and (settings_data.rag_reranker_model_path is None)
    ):
        raise HTTPException(status_code=400, detail="Нет полей для обновления")
    try:
        before = await get_user_rag_settings(user_id)
        _chunk_before = (
            str(before.get("rag_chunking_strategy") or ""),
            int(before.get("rag_chunk_size") or 0),
            int(before.get("rag_chunk_overlap") or 0),
        )
        updates: dict = {}
        if strat is not None:
            updates["rag_strategy"] = strat
        if settings_data.agentic_rag_enabled is not None:
            updates["agentic_rag_enabled"] = bool(settings_data.agentic_rag_enabled)
        if settings_data.agentic_max_iterations is not None:
            ami = int(settings_data.agentic_max_iterations)
            updates["agentic_max_iterations"] = max(1, min(ami, 5))
        if settings_data.rag_query_fix_typos is not None:
            updates["rag_query_fix_typos"] = bool(settings_data.rag_query_fix_typos)
        if settings_data.rag_multi_query_enabled is not None:
            updates["rag_multi_query_enabled"] = bool(settings_data.rag_multi_query_enabled)
        if settings_data.rag_hyde_enabled is not None:
            updates["rag_hyde_enabled"] = bool(settings_data.rag_hyde_enabled)
        if settings_data.rag_chat_top_k is not None:
            try:
                rk = int(settings_data.rag_chat_top_k)
                updates["rag_chat_top_k"] = max(1, min(rk, 64))
            except (TypeError, ValueError) as e:
                raise HTTPException(status_code=400, detail="rag_chat_top_k: ожидается целое число 1–64") from e
        if chunking is not None:
            updates["rag_chunking_strategy"] = chunking
        if settings_data.rag_chunk_size is not None:
            try:
                size = int(settings_data.rag_chunk_size)
                updates["rag_chunk_size"] = max(200, min(size, 8000))
            except (TypeError, ValueError) as e:
                raise HTTPException(status_code=400, detail="rag_chunk_size: ожидается целое число 200–8000") from e
        if settings_data.rag_chunk_overlap is not None:
            try:
                overlap = int(settings_data.rag_chunk_overlap)
                updates["rag_chunk_overlap"] = max(0, min(overlap, 2000))
            except (TypeError, ValueError) as e:
                raise HTTPException(status_code=400, detail="rag_chunk_overlap: ожидается целое число 0–2000") from e
        if settings_data.rag_similarity_threshold is not None:
            try:
                threshold = float(settings_data.rag_similarity_threshold)
                updates["rag_similarity_threshold"] = max(0.0, min(threshold, 1.0))
            except (TypeError, ValueError) as e:
                raise HTTPException(status_code=400, detail="rag_similarity_threshold: ожидается число 0..1") from e
        if settings_data.rag_reranking_enabled is not None:
            updates["rag_reranking_enabled"] = bool(settings_data.rag_reranking_enabled)
        if settings_data.rag_rerank_top_n is not None:
            try:
                top_n = int(settings_data.rag_rerank_top_n)
                updates["rag_rerank_top_n"] = max(1, min(top_n, 64))
            except (TypeError, ValueError) as e:
                raise HTTPException(status_code=400, detail="rag_rerank_top_n: ожидается целое число 1–64") from e
        if settings_data.rag_system_prompt is not None:
            prompt = str(settings_data.rag_system_prompt or "").strip()
            updates["rag_system_prompt"] = (
                prompt
                if prompt
                else "Используй только предоставленный контекст. Если ответа нет в тексте, скажи «Не знаю». Не придумывай факты."
            )
        if settings_data.rag_embedding_model_path is not None:
            updates["rag_embedding_model_path"] = str(settings_data.rag_embedding_model_path or "").strip()
        if settings_data.rag_reranker_model_path is not None:
            updates["rag_reranker_model_path"] = str(settings_data.rag_reranker_model_path or "").strip()

        if not updates:
            raise HTTPException(status_code=400, detail="Нет полей для обновления")

        logger.debug("[RAG-CFG] персональные настройки user=%s: %s", user_id, updates)
        merged = await save_user_rag_settings(user_id, updates)

        if "rag_chat_top_k" in updates or "rag_rerank_top_n" in updates:
            bump_rag_semantic_cache()

        _chunk_after = (
            str(merged.get("rag_chunking_strategy") or ""),
            int(merged.get("rag_chunk_size") or 0),
            int(merged.get("rag_chunk_overlap") or 0),
        )
        # Только явная смена полей нарезки — не top_k / similarity / toggles.
        chunk_fields_touched = any(
            k in updates
            for k in ("rag_chunking_strategy", "rag_chunk_size", "rag_chunk_overlap")
        )
        if (
            _rechunk_on_settings_change()
            and chunk_fields_touched
            and _chunk_after != _chunk_before
        ):
            logger.info(
                "[RECHUNK-USER] чанкинг изменился user=%s → scoped перечанковка",
                user_id,
            )
            asyncio.create_task(
                _run_background_rechunk_for_user(user_id, chunk_params_from_rag_settings(merged))
            )
        return {"message": "Настройки RAG обновлены", "success": True, **settings_response_dict(merged)}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка операции")
        raise HTTPException(status_code=500, detail=str(e)) from e


async def _run_global_reindex(chunk_params: dict, include_memory: bool) -> None:
    """Полный реиндекс KB + проектов (все документы всех пользователей)."""
    global _cluster_reindex_active
    if not rag_client:
        return
    cs = chunk_params.get("chunk_size")
    co = chunk_params.get("chunk_overlap")
    strat = chunk_params.get("chunking_strategy")
    logger.info(
        "[REINDEX-ALL] старт: strategy=%s chunk_size=%s overlap=%s memory=%s",
        strat,
        cs,
        co,
        include_memory,
    )
    # Флаг снимает /api/rag/reindex-status по факту освобождения локов svc-rag:
    # здесь мы узнаём только момент ПОСТАНОВКИ задачи (svc-rag отвечает "started"
    # сразу), а работа идёт ещё десятки минут.
    _cluster_reindex_active = True
    _mark_reindex_started()
    try:
        kb_res = await rag_client.kb_reindex(
            chunk_size=cs, chunk_overlap=co, chunking_strategy=strat
        )
        logger.info("[REINDEX-ALL] kb готово: %s", kb_res)
    except Exception:
        logger.exception("[REINDEX-ALL] kb ошибка")
    try:
        proj_res = await rag_client.project_rag_reindex_all(
            chunk_size=cs, chunk_overlap=co, chunking_strategy=strat
        )
        logger.info("[REINDEX-ALL] projects готово: %s", proj_res)
    except Exception:
        logger.exception("[REINDEX-ALL] projects ошибка")
    if include_memory:
        try:
            from backend.services.memory_rag_env import get_memory_chunk_index_params
            
            mem = get_memory_chunk_index_params()
        except Exception:
            mem = {
                "chunk_size": cs,
                "chunk_overlap": co,
                "chunking_strategy": "universal",
            }
        try:
            mem_res = await rag_client.memory_rag_reindex(
                chunk_size=mem.get("chunk_size"),
                chunk_overlap=mem.get("chunk_overlap"),
                chunking_strategy=mem.get("chunking_strategy"),
            )
            logger.info("[REINDEX-ALL] memory готово: %s", mem_res)
        except Exception:
            logger.exception("[REINDEX-ALL] memory ошибка")
    logger.info("[REINDEX-ALL] задачи поставлены в svc-rag")
        

@router.post("/api/rag/reindex-all")
async def reindex_all_documents(
    current_user: Annotated[dict, Depends(get_current_user)],
    include_memory: bool = False,
):
    """ПОЛНЫЙ реиндекс: KB + проекты всех пользователей текущей моделью.

    Memory — только при include_memory=true (по умолчанию не трогаем: её нарезка из ENV).
    Возвращает сразу, работа идёт в фоне; следить по логам [REINDEX-ALL] и [REINDEX kb|project].
    """
    require_service("rag")
    if not rag_client:
        raise HTTPException(status_code=503, detail="RAG service недоступен")
    user_id = str(current_user.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    logger.warning(
        "[REINDEX-ALL] запущен пользователем %s (memory=%s)", user_id, include_memory
    )
    merged = await get_user_rag_settings(user_id)
    asyncio.create_task(
        _run_global_reindex(chunk_params_from_rag_settings(merged), bool(include_memory))
    )
    return {
        "ok": True,
        "status": "started",
        "scope": "kb+projects" + ("+memory" if include_memory else ""),
    }


PHOENIX_PROVIDER_ID = os.getenv("RAG_PHOENIX_PROVIDER_ID", "PHOENIX")

def _phoenix_guess_kind(model_id: str) -> Optional[str]:
    n = (model_id or "").lower()
    if "rerank" in n:
        return "reranker"
    if "embed" in n:
        return "embedding"
    return None  # LLM и прочее в RAG-селекторе не показываем

async def _phoenix_rag_models(model_type: Optional[str] = None) -> list:
    """Модели Phoenix (GET /v1/models через llm_providers) для селектора RAG.

    Это и есть discovery без curl: реальные id моделей видны в UI и в логе.
    """
    from backend.llm_providers.registry import get_registry

    registry = await get_registry()
    if not registry.contains(PHOENIX_PROVIDER_ID):
        logger.warning(
            "[PHOENIX] провайдер %r не найден в реестре LLM — phoenix-модели в каталоге не появятся",
            PHOENIX_PROVIDER_ID,
        )
        return []
    provider = registry.get(PHOENIX_PROVIDER_ID)
    infos = await provider.list_models()
    rows: list = []
    logger.info("[PHOENIX] сырые модели: %s", [getattr(i, "model_id", "") for i in (infos or [])])
    for info in infos or []:
        model_id = str(getattr(info, "model_id", "") or "").strip()
        if not model_id:
            continue
        kind = _phoenix_guess_kind(model_id)
        if kind is None or (model_type and kind != model_type):
            continue
        rows.append(
            {
                "path": f"phoenix/{model_id}",
                "name": model_id,
                "display_name": model_id,
                "source": "phoenix",
                "kind": kind,
                "description": "Модель Phoenix (LiteLLM)",
                "available": True,
            }
        )
    logger.info("[PHOENIX] RAG-каталог: %s", [r["path"] for r in rows])
    return rows


@router.get("/api/rag/models")
async def list_rag_models(
    current_user: Annotated[dict, Depends(get_current_user)],
    type: str | None = None,
):
    """Список моделей эмбеддингов и cross-encoder из SVC-RAG-MODELS."""
    require_service("rag_models")
    if not rag_models_client:
        raise HTTPException(status_code=503, detail="RAG-models service недоступен")
    try:
        data = await rag_models_client.list_models(type)
        # Только local (+ phoenix ниже); внешние каталоги отфильтровываем
        models = data.get("models") or {}
        for kind_key in ("embedding", "reranker"):
            rows = models.get(kind_key) or []
            models[kind_key] = [
                r
                for r in rows
                if str((r or {}).get("source") or "").lower() in ("local", "")
                or str((r or {}).get("path") or "").lower().startswith("local/")
            ]
        data["models"] = models
        try:
            phoenix_rows = await _phoenix_rag_models(type)
            if phoenix_rows:
                models = data.get("models") or {}
                for row in phoenix_rows:
                    models.setdefault(row["kind"], []).append(row)
                data["models"] = models
        except Exception:
            logger.exception("Каталог Phoenix недоступен - показываю только локальные")
        user_id = str(current_user.get("user_id") or "").strip()
        user_rag = await get_user_rag_settings(user_id) if user_id else {}
        return _overlay_user_model_current(data, user_rag)
    except Exception as e:
        logger.exception("list_rag_models error")
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.get("/api/rag/models/current")
async def get_rag_models_current(current_user: Annotated[dict, Depends(get_current_user)]):
    require_service("rag_models")
    if not rag_models_client:
        raise HTTPException(status_code=503, detail="RAG-models service недоступен")
    try:
        data = await rag_models_client.get_current()
        user_id = str(current_user.get("user_id") or "").strip()
        user_rag = await get_user_rag_settings(user_id) if user_id else {}
        return _overlay_user_model_current(data, user_rag)
    except Exception as e:
        logger.exception("get_rag_models_current error")
        raise HTTPException(status_code=502, detail=str(e)) from e


async def _current_cluster_embedding_dim() -> Optional[int]:
    """Текущая dim загруженной модели / health (до миграции схемы)."""
    if not rag_models_client:
        return None
    try:
        health = await rag_models_client.health()
        if isinstance(health, dict) and health.get("embedding_dim"):
            return int(health["embedding_dim"])
    except Exception:
        logger.debug("health embedding_dim недоступен", exc_info=True)
    return None


async def _select_phoenix_rag_model(model_type: str, model_path: str, user_id: str):
    """Персональный выбор Phoenix-модели.

    Кластер НЕ переключаем: после B2/B3 модель едет в теле каждого запроса, а
    вектора ложатся в таблицу своей размерности. Прежний set_models_provider
    менял провайдера всем сразу, а 409-гард запрещал чужую dim — теперь
    запрещать нечего.
    """
    if not rag_client:
        raise HTTPException(status_code=503, detail="RAG service недоступен")
    model_id = model_path.split("/", 1)[1].strip()
    if not model_id:
        raise HTTPException(status_code=400, detail="Пустой id модели Phoenix")

    try:
        phoenix_rows = await _phoenix_rag_models(model_type)
    except Exception as e:
        logger.exception("Phoenix catalog error")
        raise HTTPException(status_code=502, detail=str(e)) from e
    paths = {str((r or {}).get("path") or "").strip() for r in (phoenix_rows or [])}
    if paths and model_path not in paths:
        raise HTTPException(
            status_code=400,
            detail=f"Модель Phoenix {model_path!r} не найдена в каталоге",
        )
    result: dict = {
        "success": True,
        "model_type": model_type,
        "model_path": model_path,
        "cluster_changed": False,
    }

    if model_type == "embedding":
        merged = await save_user_rag_settings(
            user_id, {"rag_embedding_model_path": model_path}
        )
        if _reindex_on_model_change():
            # Документы пользователя переезжают в таблицу новой размерности;
            # чужие вектора и Библиотека не затрагиваются.
            asyncio.create_task(
                _run_background_reindex_for_user(
                    user_id, chunk_params_from_rag_settings(merged)
                )
            )
    else:
        await save_user_rag_settings(user_id, {"rag_reranker_model_path": model_path})
    bump_rag_semantic_cache()
    logger.info(
        "[RAG-CFG] персональный выбор Phoenix user=%s type=%s path=%s "
        "(кластер и Библиотека не меняются)",
        user_id,
        model_type,
        model_path,
    )
    result["message"] = "Модель сохранена в ваших настройках"
    result["reindexed"] = model_type == "embedding" and _reindex_on_model_change()
    return result


@router.post("/api/rag/models/select")
async def select_rag_model(
    body: RagModelSelectRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
):
    """Выбор embedding/reranker: загружает модель и сохраняет путь пользователю.

    - UI-выбор у других пользователей не меняется (персональный Postgres).
    - Memory RAG не переиндексируется.
    - Смена dim из UI запрещена.
    - При той же dim — scoped reindex только project + agent KB этого пользователя.
    """
    require_service("rag_models")
    if not rag_models_client:
        raise HTTPException(status_code=503, detail="RAG-models service недоступен")
    user_id = str(current_user.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    model_type = str(body.model_type or "").strip().lower()
    if model_type not in ("embedding", "reranker"):
        raise HTTPException(status_code=400, detail="model_type должен быть embedding или reranker")
    model_path = str(body.model_path or "").strip()
    if not model_path:
        raise HTTPException(status_code=400, detail="model_path обязателен")
    logger.debug(
        "[RAG-CFG] Выбор RAG-модели user=%s: type=%s, path=%s",
        user_id,
        model_type,
        model_path,
    )
    if model_path.lower().startswith("huggingface/"):
        raise HTTPException(
            status_code=400,
            detail="Источник huggingface отключён: выберите local/<папка> из models/rag",
        )
    if model_path.lower().startswith("phoenix/"):
        return await _select_phoenix_rag_model(model_type, model_path, user_id)
    try:
        await _validate_local_model_path(model_type, model_path)
        # Кластер не трогаем: модель едет в теле запроса, svc-rag-models поднимет
        # её сам по имени (LRU из фазы A), вектора лягут в таблицу своей
        # размерности. Прежний select_model менял модель ВСЕМ, а 409-гард
        # запрещал чужую dim — с раздельными таблицами это больше не нужно.
        result: dict = {
            "success": True,
            "model_type": model_type,
            "model_path": model_path,
            "cluster_changed": False,
        }

        if model_type == "embedding":
            merged = await save_user_rag_settings(
                user_id, {"rag_embedding_model_path": model_path}
            )
            if _reindex_on_model_change():
                logger.info(
                    "[REINDEX-USER] смена embedding user=%s → scoped reindex (без Memory)",
                    user_id,
                )
                asyncio.create_task(
                    _run_background_reindex_for_user(
                        user_id, chunk_params_from_rag_settings(merged)
                    )
                )
        else:
            await save_user_rag_settings(user_id, {"rag_reranker_model_path": model_path})
        bump_rag_semantic_cache()
        result["message"] = "Модель сохранена в ваших настройках"
        result["reindexed"] = (
            model_type == "embedding" and _reindex_on_model_change()
        )
        logger.info(
            "[RAG-CFG] персональный выбор модели user=%s type=%s path=%s "
            "(кластер и Библиотека не меняются)",
            user_id,
            model_type,
            model_path,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("select_rag_model error")
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.post("/api/kb/documents")
async def kb_upload_document(
    file: Annotated[UploadFile, File(...)],
    current_user: Annotated[dict, Depends(get_current_user)],
    chunking_strategy: Annotated[Optional[str], Form()] = None,
    agent_id: Annotated[Optional[int], Form()] = None,
):
    """Загрузка в KB (агентный RAG).

    owner_user_id = автор агента (не uploader): файлы редактора принадлежат владельцу,
    и только владелец может запускать их перечанковку через свои RAG-настройки.
    Параметры чанкинга — из персональных настроек владельца (если agent_id задан)
    или текущего пользователя.
    """
    require_service("rag")
    if not rag_client:
        raise HTTPException(status_code=503, detail="RAG service недоступен")
    username = _rag_upload_username(current_user)
    uploader_id = str(current_user.get("user_id") or "").strip().lower()
    file_object_name = None
    file_bucket = None
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Файл пустой")
        fn = file.filename or "unknown"

        owner_user_id = uploader_id
        resolved_agent_id: Optional[int] = None
        if agent_id is not None:
            from backend.database.init_db import get_agent_repository
            from backend.database.postgresql.agent_models import (
                AGENT_PERMISSION_EDITOR,
                AGENT_PERMISSION_OWNER,
            )

            agent_repo = get_agent_repository()
            permission = await agent_repo.get_user_permission(int(agent_id), uploader_id)
            if permission not in (AGENT_PERMISSION_OWNER, AGENT_PERMISSION_EDITOR):
                raise HTTPException(
                    status_code=403,
                    detail="Недостаточно прав для загрузки файлов в KB агента",
                )
            agent = await agent_repo.get_agent(int(agent_id), uploader_id)
            if not agent:
                raise HTTPException(status_code=404, detail="Агент не найден")
            owner_user_id = str(agent.author_id or uploader_id).strip().lower()
            resolved_agent_id = int(agent_id)

        # Чанкинг: настройки владельца агента (он же контролирует rechunk)
        settings_user = owner_user_id or uploader_id
        user_rag = await get_user_rag_settings(settings_user) if settings_user else {}
        chunk_params = chunk_params_from_rag_settings(user_rag) if user_rag else get_rag_chunk_index_params()
        strategy = (chunking_strategy or "").strip().lower()
        if strategy and strategy in _VALID_CHUNKING_STRATEGIES | {"universal"}:
            chunk_params["chunking_strategy"] = strategy
        elif not strategy:
            # Без явной strategy из конструктора — библиотечный universal
            if resolved_agent_id is None:
                chunk_params = get_library_chunk_index_params()

        if use_rag_pvc():
            file_object_name = save_rag_bytes_to_pvc(
                content,
                fn,
                scope="agent",
                username=username,
                prefix="kb_",
                content_type=file.content_type or "application/octet-stream",
            )
            if not file_object_name:
                raise HTTPException(
                    status_code=500,
                    detail=f"Не удалось сохранить файл в PVC — проверьте {RAG_PVC_DIR_ENV} и mount /ragdb",
                )
            file_bucket = RAG_PVC_BUCKET_MARKER
        try:
            from backend.services.user_rag_settings import (
                embedding_fields_from_rag_settings,
            )

            # Модель владельца агента, а не заливающего: реиндекс документа
            # потом запустит владелец из своих настроек, и модель должна совпасть.
            out = await rag_client.kb_upload_document(
                file_bytes=content,
                filename=fn,
                minio_object=file_object_name,
                minio_bucket=file_bucket,
                owner_user_id=owner_user_id or None,
                agent_id=resolved_agent_id,
                uploaded_by=username or None,
                **chunk_params,
                **embedding_fields_from_rag_settings(user_rag),
            )
        except Exception as e:
            if file_object_name and file_bucket:
                with logged_suppress(logger):
                    _delete_rag_source_file(file_object_name, file_bucket)
            raise
        bump_rag_semantic_cache()
        return out
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка операции")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/api/kb/documents")
async def kb_list_documents():
    require_service("rag")
    if not rag_client:
        raise HTTPException(status_code=503, detail="RAG service недоступен")
    try:
        docs = await rag_client.kb_list_documents()
        return {"documents": docs}
    except Exception as e:
        logger.exception("Ошибка операции")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete("/api/kb/documents/{document_id}")
async def kb_delete_document(document_id: int):
    require_service("rag")  # FEATURE-FLAG
    if not rag_client:
        raise HTTPException(status_code=503, detail="RAG service недоступен")
    try:
        out = await rag_client.kb_delete_document(document_id)
        if isinstance(out, dict) and out.get("ok") is False:
            raise HTTPException(status_code=404, detail="Документ не найден")
        if isinstance(out, dict):
            _delete_rag_source_file(out.get("minio_object"), out.get("minio_bucket"))
        bump_rag_semantic_cache()
        return {"ok": True, "document_id": document_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка операции")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/api/memory-rag/documents")
async def memory_rag_upload(
    file: Annotated[UploadFile, File(...)],
    current_user: Annotated[dict, Depends(get_current_user)],
):
    """Глобальный / memory RAG (Настройки → RAG). MinIO или PVC — по флагу RAG_USE_PVC."""
    require_service("rag")  # FEATURE-FLAG
    if not use_rag_pvc():
        require_service("minio")  # FEATURE-FLAG
    if not rag_client:
        raise HTTPException(status_code=503, detail="RAG service недоступен")
    username = _rag_upload_username(current_user)
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Файл пустой")
        fn = file.filename or "unknown"
        ext = os.path.splitext(fn)[1] or ".bin"
        file_object_name = None
        memory_bucket = None
        if use_rag_pvc():
            file_object_name = save_rag_bytes_to_pvc(
                content,
                fn,
                scope="memory",
                username=username,
                prefix="memrag_",
                content_type=file.content_type or "application/octet-stream",
            )
            if not file_object_name:
                raise HTTPException(
                    status_code=500,
                    detail=f"Не удалось сохранить файл в PVC — проверьте {RAG_PVC_DIR_ENV} и mount /ragdb",
                )
            memory_bucket = RAG_PVC_BUCKET_MARKER
        else:
            memory_bucket = settings.minio.memory_rag_bucket_name
            if minio_client:
                try:
                    minio_client.ensure_bucket(memory_bucket)
                    file_object_name = minio_client.generate_object_name(prefix="memrag_", extension=ext)
                    minio_client.upload_file(
                        content,
                        file_object_name,
                        content_type=file.content_type or "application/octet-stream",
                        bucket_name=memory_bucket,
                    )
                except Exception as e:
                    logger.exception("MinIO memory-rag upload")
                    raise HTTPException(status_code=500, detail=f"MinIO: {e}") from e
        try:
            # Библиотека памяти: всегда universal chunking
            chunk_params = get_library_chunk_index_params()
            result = await rag_client.memory_rag_index_document(
                file_bytes=content,
                filename=fn,
                minio_object=file_object_name,
                minio_bucket=memory_bucket if file_object_name else None,
                **chunk_params,
            )
        except Exception as e:
            logger.exception("Ошибка операции")
            if file_object_name and memory_bucket:
                with logged_suppress(logger):
                    _delete_rag_source_file(file_object_name, memory_bucket)
            if _is_upstream_httpx_timeout(e):
                raise HTTPException(
                    status_code=504,
                    detail="Таймаут ответа SVC-RAG при индексации (большой файл или медленный embed). Увеличьте SVC_RAG_INDEX_READ_TIMEOUT (секунды) для backend, по умолчанию 900.",
                ) from e
            raise HTTPException(status_code=502, detail=str(e)) from e
        bump_rag_semantic_cache()
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка операции")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/api/memory-rag/documents")
async def memory_rag_list():
    require_service("rag")
    if not rag_client:
        raise HTTPException(status_code=503, detail="RAG service недоступен")
    try:
        docs = await rag_client.memory_rag_list_documents()
        return {"documents": docs}
    except Exception as e:
        logger.exception("Ошибка операции")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete("/api/memory-rag/documents/{document_id}")
async def memory_rag_delete(document_id: int):
    require_service("rag")
    if not rag_client:
        raise HTTPException(status_code=503, detail="RAG service недоступен")
    try:
        out = await rag_client.memory_rag_delete_document(document_id)
        if not out.get("ok"):
            raise HTTPException(status_code=404, detail="Документ не найден")
        _delete_rag_source_file(out.get("minio_object"), out.get("minio_bucket"))
        bump_rag_semantic_cache()
        return {"ok": True, "document_id": document_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка операции")
        raise HTTPException(status_code=500, detail=str(e)) from e

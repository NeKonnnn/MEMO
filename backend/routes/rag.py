"""
routes/rag.py - настройки RAG, База Знаний (KB), библиотека памяти (memory-rag)
"""

import os
import time
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
    SCOPES,
    chunk_params_from_rag_settings,
    default_rag_settings_snapshot,
    get_user_rag_settings,
    normalize_scope,
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


def _mark_user_scoped_reindex(
    user_id: str, *, active: bool, scope: Optional[str] = None
) -> None:
    """Флаг "идет scoped-перечанковка" - только для затронутого стора"""
    uid = _norm_uid(user_id)
    if not uid:
        return
    sc = (scope or "").strip().lower()
    targets = []
    if sc in ("", "agent"):
        targets.append(_user_scoped_reindex_kb)
    if sc in ("", "project"):
        targets.append(_user_scoped_reindex_project)
    for target in targets:
        if active:
            target.add(uid)
        else:
            target.discard(uid)


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
async def get_rag_settings(
    current_user: Annotated[dict, Depends(get_current_user)],
    scope: Optional[str] = None,
):
    """Персональные RAG-настройки одного стора.

    ```scope``` — project (по умолчанию) или agent. Общие поля (стратегия поиска,
    agentic_*, препроцесс запроса) одинаковы в обоих скоупах, остальные свои.

    Memory RAG (кроме стратегии поиска) — только ConfigMap/env SVC-RAG / SVC-RAG-MODELS.
    """
    user_id = str(current_user.get("user_id") or "").strip()
    sc = normalize_scope(scope)
    settings_data = await get_user_rag_settings(user_id, sc)
    return {**settings_response_dict(settings_data), "scope": sc}


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
    """Агрегированный статус перечанковки RAG для UI (плашка и стоппер).

    Здесь же уезжает 'memory_rag_enabled': по нему
    интерфейс гасит тумблер Библиотеки, когда стор выключен в ConfigMap
    """
    from backend.realtime.rag_evidence import memory_rag_enabled

    memory_enabled = memory_rag_enabled()
    empty_payload = {
        "memory": {"reindexing": False},
        "project": {"reindexing": False},
        "kb": {"reindexing": False},
        "any_reindexing": False,
        "agent_has_kb": False,
        "project_has_documents": False,
        "memory_rag_enabled": memory_enabled,
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
        "memory_rag_enabled": memory_enabled,
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
                "rag_system_prompt": "",
            }
        )
        # Сброс — во ВСЕ скоупы: пользователь ждёт «как из коробки» целиком,
        # а не только для того стора, что открыт в UI.
        merged = None
        for sc in SCOPES:
            merged = await save_user_rag_settings(user_id, defaults, sc)
        bump_rag_semantic_cache()
        return {"message": "Настройки RAG сброшены", "success": True, **settings_response_dict(merged or defaults)}
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


async def _run_background_rechunk_for_user(
    user_id: str, chunk_params: dict, scope: Optional[str] = None
) -> None:
    """Перечанковка документов в пределах ОДНОГО стора.

    ```scope="agent"``` — только agent KB (документы, где owner_user_id = пользователь),
    ```scope="project"``` — только документы проектов. Без scope трогает оба, как было
    до разделения настроек.

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

    emb = await embedding_fields_for_user(oid, scope)
    logger.info(
        "[RECHUNK-USER] старт user=%s scope=%s model=%s strategy=%s chunk_size=%s ",
        "overlap=%s agent_docs=%s",
        oid,
        scope or "both",
        emb.get("embedding_model"),
        strat,
        cs,
        co,
        len(agent_doc_ids),
    )
    sc = (scope or "").strip().lower()
    do_agent = sc in ("", "agent")
    do_project = sc in ("", "project")
    _mark_user_scoped_reindex(oid, active=True, scope=scope)
    _mark_reindex_started()
    try:
        if do_agent:
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
        if do_project:
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
        _mark_user_scoped_reindex(oid, active=False, scope=scope)
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


async def _run_background_reindex_for_user(user_id: str, chunk_params: dict, scope: Optional[str] = None) -> None:
    """Переиндексация документов пользователя в пределах сторна (без Memory)"""
    await _run_background_rechunk_for_user(user_id, chunk_params, scope)


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
    scope = normalize_scope(settings_data.scope)
    try:
        before = await get_user_rag_settings(user_id, scope)
        _chunk_before = (
            str(before.get("rag_chunking_strategy") or ""),
            int(before.get("rag_chunk_size") or 0),
            int(before.get("rag_chunk_overlap") or 0),
        )
        updates: dict = {}
        if strat is not None:
            updates["rag_strategy"] = strat
        if settings_data.rag_memory_strategy is not None:
            mem_strat = str(settings_data.rag_memory_strategy).strip().lower()
            if mem_strat and mem_strat not in _VALID_STRATEGIES:
                raise HTTPException(
                    status_code=400,
                    detail=f"Недопустимая стратегия Библиотеки. Допустимые: {_VALID_STRATEGIES}",
                )
            if mem_strat:
                updates["rag_memory_strategy"] = mem_strat
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
            # Пустая строка допустима: тогда soft-rules; иначе — текст из UI как есть.
            updates["rag_system_prompt"] = str(settings_data.rag_system_prompt or "").strip()
        if settings_data.rag_embedding_model_path is not None:
            updates["rag_embedding_model_path"] = str(settings_data.rag_embedding_model_path or "").strip()
        if settings_data.rag_reranker_model_path is not None:
            updates["rag_reranker_model_path"] = str(settings_data.rag_reranker_model_path or "").strip()

        if not updates:
            raise HTTPException(status_code=400, detail="Нет полей для обновления")

        logger.debug("[RAG-CFG] персональные настройки user=%s scope=%s: %s", user_id, scope, updates)
        merged = await save_user_rag_settings(user_id, updates, scope)

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
                "[RECHUNK-USER] чанкинг изменился user=%s scope=%s → scoped перечанковка только для этого стора",
                user_id,
                scope,
            )
            asyncio.create_task(
                _run_background_rechunk_for_user(user_id, chunk_params_from_rag_settings(merged), scope)
            )
        return {
            "message": "Настройки RAG обновлены", 
            "success": True, 
            **settings_response_dict(merged), 
            "scope": scope,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка операции")
        raise HTTPException(status_code=500, detail=str(e)) from e


async def _run_global_reindex(
    agent_params: dict, project_params: dict, include_memory: bool
) -> None:
    """Полный реиндекс KB + проектов (все документы всех пользователей)."""
    global _cluster_reindex_active
    if not rag_client:
        return
    a_cs = agent_params.get("chunk_size")
    a_co = agent_params.get("chunk_overlap")
    a_strat = agent_params.get("chunking_strategy")
    p_cs = project_params.get("chunk_size")
    p_co = project_params.get("chunk_overlap")
    p_strat = project_params.get("chunking_strategy")
    # Для fallback-а на старые версии без scope:
    cs, co = a_cs, a_co
    logger.info(
        "[REINDEX-ALL] старт: agent strategy=%s chunk_size=%s overlap=%s project strategy=%s chunk_size=%s overlap=%s memory=%s",
        a_strat, 
        a_cs, 
        a_co, 
        p_strat, 
        p_cs, 
        p_co, 
        include_memory,
    )
    # Флаг снимает /api/rag/reindex-status по факту освобождения локов svc-rag:
    # здесь мы узнаём только момент ПОСТАНОВКИ задачи (svc-rag отвечает "started"
    # сразу), а работа идёт ещё десятки минут.
    _cluster_reindex_active = True
    _mark_reindex_started()
    try:
        kb_res = await rag_client.kb_reindex(
            chunk_size=a_cs, chunk_overlap=a_co, chunking_strategy=a_strat
        )
        logger.info("[REINDEX-ALL] kb готово: %s", kb_res)
    except Exception:
        logger.exception("[REINDEX-ALL] kb ошибка")
    try:
        proj_res = await rag_client.project_rag_reindex_all(
            chunk_size=p_cs, chunk_overlap=p_co, chunking_strategy=p_strat
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
    agent_merged = await get_user_rag_settings(user_id, "agent")
    project_merged = await get_user_rag_settings(user_id, "project")
    asyncio.create_task(
        _run_global_reindex(
            chunk_params_from_rag_settings(agent_merged), 
            chunk_params_from_rag_settings(project_merged), 
            bool(include_memory),
        )
    )
    return {
        "ok": True,
        "status": "started",
        "scope": "kb+projects" + ("+memory" if include_memory else ""),
    }


PHOENIX_PROVIDER_ID = os.getenv("RAG_PHOENIX_PROVIDER_ID", "PHOENIX")
CORSUR_PROVIDER_ID = os.getenv("RAG_CORSUR_PROVIDER_ID", "CORSUR")
# Phoenix под ключом эмбеддингов: /v1/models отдаёт только эмбеддеры и реранкеры.
PHOENIX_EMBEDDINGS_PROVIDER_ID = os.getenv(
    "RAG_PHOENIX_EMBEDDINGS_PROVIDER_ID", "PHOENIX_Embeddings"
)

# Внешние OpenAI-совместимые источники эмбеддингов/реранка в UI.
# Вкладки (порядок и написание): CORSUR → PHOENIX → PHOENIX_Embeddings.
_EXTERNAL_RAG_CATALOG = (
    {
        "provider_id": CORSUR_PROVIDER_ID,
        "path_prefix": "corsur",
        "source": "corsur",
        "description": "Модель CORSUR (llm.corsur)",
        "rag_only": True,
    },
    {
        "provider_id": PHOENIX_PROVIDER_ID,
        "path_prefix": "phoenix",
        "source": "phoenix",
        "description": "Модель Phoenix (LiteLLM)",
        "rag_only": False,
    },
    {
        "provider_id": PHOENIX_EMBEDDINGS_PROVIDER_ID,
        "path_prefix": "phoenix_embeddings",
        "source": "phoenix_embeddings",
        "description": "Модель Phoenix Embeddings (LiteLLM, emb-ключ)",
        "rag_only": True,
    },
)

# Подсказки к типу модели. Это СЕМЕЙСТВА, а не конкретные id: список моделей
# приходит из /v1/models и нигде не хардкодится. Дополняются переменными
# окружения через запятую — новое семейство не требует правки кода:
#   RAG_RERANKER_NAME_HINTS=colbert,monot5
#   RAG_EMBEDDING_NAME_HINTS=jina,nomic
# Реранкерные проверяются ПЕРВЫМИ: 'bge/bge-rerank' → reranker, 'bge/bge-m3' → embedding.
_RERANKER_NAME_HINTS_DEFAULT = ("rerank", "cross-encoder", "crossencoder", "marco")
_EMBEDDING_NAME_HINTS_DEFAULT = (
    "embed",
    "bge",
    "frida",
    "giga",
    "e5-",
    "gte-",
    "labse",
    "minilm",
)

def _name_hints(env_name: str, defaults: tuple) -> tuple:
    extra = (os.getenv(env_name, "") or "").replace(";", ",")
    parts = [p.strip().lower() for p in extra.split(",") if p.strip()]
    return tuple(defaults) + tuple(p for p in parts if p not in defaults)

_RERANKER_NAME_HINTS = _name_hints(
    "RAG_RERANKER_NAME_HINTS", _RERANKER_NAME_HINTS_DEFAULT
)
_EMBEDDING_NAME_HINTS = _name_hints(
    "RAG_EMBEDDING_NAME_HINTS", _EMBEDDING_NAME_HINTS_DEFAULT
)


def _rag_model_kind(model_id: str, *, rag_only: bool) -> Optional[str]:
    """Тип RAG-модели по её id. None — модель не для RAG-селектора.

    ```rag_only=True``` — шлюз отдаёт только эмбеддеры и реранкеры, поэтому
    неизвестное имя считаем эмбеддером, а не выбрасываем: иначе ```bge-m3```,
    ```FRIDA```, ```multilingual-e5-large``` молча исчезают из селектора.
    ```rag_only=False``` — на шлюзе есть и чат-модели, тип обязан быть виден
    по имени, иначе в RAG-селектор попадут LLM.
    """
    n = (model_id or "").lower()
    if any(h in n for h in _RERANKER_NAME_HINTS):
        return "reranker"
    if any(h in n for h in _EMBEDDING_NAME_HINTS):
        return "embedding"
    return "embedding" if rag_only else None

# --- Проверка, что объявленная моделью строка каталога реально работает -----
# Шлюзы объявляют модели, которые вызвать нельзя: у PHOENIX это битые алиасы
# вроде "QWEN3 EMBEDDING 8B" (400 Invalid model name), у CORSUR — чат-модели,
# попадающие в embedding-список из-за rag_only.
#
# Но «не ответила» бывает двух совершенно разных сортов, и путать их нельзя:
#   * шлюз ВНЯТНО отверг модель (400/422, или 200 без вектора) — прячем;
#   * шлюз недоступен, тормозит, отдаёт 5xx или таймаут — НЕ прячем.
# Второе — состояние шлюза, а не модели. 31.07 из-за этого селектор опустел
# целиком: у PHOENIX рабочая qwen3-embedding-06b-f16 не уложилась в таймаут,
# и единственный живой эмбеддер исчез из UI.
_PROBE_TTL_SECONDS = float(os.getenv("RAG_MODEL_PROBE_TTL", "600") or 600)
# Неопределённый результат кешируем ненадолго: шлюз мог просто моргнуть.
_PROBE_TTL_UNKNOWN = float(os.getenv("RAG_MODEL_PROBE_TTL_UNKNOWN", "120") or 120)
_PROBE_TIMEOUT = float(os.getenv("RAG_MODEL_PROBE_TIMEOUT", "15") or 15)
_PROBE_MAX_PARALLEL = 8

_PROBE_OK = "ok"
_PROBE_BAD = "bad"          # модель заведомо не работает — прятать
_PROBE_UNKNOWN = "unknown"  # шлюз не в форме — оставить как есть

# (provider_id, model_id) -> (статус, dim, причина, monotonic-время проверки)
_embedding_probe_cache: dict = {}

# Кэш полного RAG-каталога (как MODELS_AVAILABLE_CACHE у LLM).
# current из user settings поверх кэша на каждом запросе — не кэшируется.
_rag_models_catalog_cache: Optional[list] = None
_rag_models_catalog_cache_ts: float = 0.0
_rag_models_catalog_cache_lock = asyncio.Lock()


def _rag_models_cache_seconds() -> int:
    """TTL каталога /api/rag/models. ENV: RAG_MODELS_CACHE_SECONDS, иначе как у LLM."""
    raw = (os.getenv("RAG_MODELS_CACHE_SECONDS", "") or "").strip()
    if raw:
        try:
            return max(1, int(raw))
        except ValueError:
            pass
    try:
        from backend.settings import get_settings

        return max(1, int(get_settings().model_health.models_available_cache_seconds))
    except Exception:
        return 60


def _invalidate_rag_models_catalog_cache() -> None:
    global _rag_models_catalog_cache, _rag_models_catalog_cache_ts
    _rag_models_catalog_cache = None
    _rag_models_catalog_cache_ts = 0.0


def _probe_enabled() -> bool:
    return str(os.getenv("RAG_MODEL_PROBE", "1")).strip().lower() not in {
        "0",
        "false",
        "no",
    }

def _hide_unavailable() -> bool:
    """Прятать неработающие модели из селектора (по умолчанию да).

    RAG_MODEL_PROBE_HIDE_UNAVAILABLE=0 — показывать их с available=false и
    причиной, если фронт умеет рисовать недоступную строку.
    """
    return str(os.getenv("RAG_MODEL_PROBE_HIDE_UNAVAILABLE", "1")).strip().lower() not in {
        "0",
        "false",
        "no",
    }

def _first_vector_len(value, depth: int = 0) -> int:
    """Длина первого списка чисел в ответе. 0 — вектора нет.

    Рекурсивно, а не по известным ключам: через bifrost-passthrough вектор
    приходит завёрнутым в chat-ответ, и точную форму снаружи знать нельзя.
    """
    if depth > 6:
        return 0
    if isinstance(value, list):
        if len(value) >= 8 and all(isinstance(x, (int, float)) for x in value[:8]):
            return len(value)
        for item in value[:3]:
            found = _first_vector_len(item, depth + 1)
            if found:
                return found
        return 0
    if isinstance(value, dict):
        for item in value.values():
            found = _first_vector_len(item, depth + 1)
            if found:
                return found
    return 0

def _classify_probe_response(resp) -> tuple:
    """(статус, dim, причина) по одному ответу шлюза."""
    if resp.status_code == 200:
        try:
            dim = _first_vector_len(resp.json())
        except Exception:
            return _PROBE_BAD, 0, "200, но тело не JSON"
        if dim:
            return _PROBE_OK, dim, ""
        # 200 без вектора — это чат-модель, попавшая в embedding-список.
        return _PROBE_BAD, 0, "200, но вектора в ответе нет (это не эмбеддер)"
    body = (resp.text or "")[:160]
    if resp.status_code in (400, 401, 403, 422):
        return _PROBE_BAD, 0, f"HTTP {resp.status_code}: {body}"
    # 404/405 — маршрута нет; 5xx — шлюзу плохо. И то и другое про шлюз.
    return _PROBE_UNKNOWN, 0, f"HTTP {resp.status_code}: {body}"

async def _probe_embedding_model(provider, model_id: str) -> tuple:
    """Пробный вектор. Возвращает (статус, dim, причина).

    Два захода, потому что эмбеддер может быть опубликован по-разному:
      1. штатный POST /v1/embeddings;
      2. если там нет маршрута (404/405) — тоннель через /v1/chat/completions
         с ```x-bf-passthrough-extra-params```. Так эмбеддинги ходят на CORSUR,
         где отдельного embeddings-маршрута на шлюзе нет. Без этого захода
         рабочий embed/FRIDA помечался недоступным и пропадал из UI.

    Кеш: успех и внятный отказ — на RAG_MODEL_PROBE_TTL, неопределённость —
    на RAG_MODEL_PROBE_TTL_UNKNOWN (шлюз мог просто моргнуть).
    """
    import time

    provider_id = str(getattr(provider, "id", "") or "")
    key = (provider_id, model_id)
    now = time.monotonic()
    cached = _embedding_probe_cache.get(key)
    if cached:
        ttl = _PROBE_TTL_UNKNOWN if cached[0] == _PROBE_UNKNOWN else _PROBE_TTL_SECONDS
        if (now - cached[3]) < ttl:
            return cached[0], cached[1], cached[2]

    base_url = str(getattr(provider, "base_url", "") or "").rstrip("/")
    if not base_url:
        # проверить нечем — не прячем модель на всякий случай
        return _PROBE_UNKNOWN, 0, "base_url не задан"

    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    try:
        api_key = str(provider.get_api_key() or "")
    except Exception:
        api_key = ""
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
        headers["X-API-Key"] = api_key
    verify_fn = getattr(provider, "_http_verify", None)
    verify = verify_fn() if callable(verify_fn) else True

    status, dim, reason = _PROBE_UNKNOWN, 0, ""
    try:
        async with httpx.AsyncClient(timeout=_PROBE_TIMEOUT, verify=verify) as client:
            resp = await client.post(
                f"{base_url}/v1/embeddings",
                headers=headers,
                json={"model": model_id, "input": ["ping"]},
            )
            status, dim, reason = _classify_probe_response(resp)

            if status != _PROBE_OK and resp.status_code in (404, 405):
                tunnel_headers = dict(headers)
                tunnel_headers["x-bf-passthrough-extra-params"] = "true"
                resp = await client.post(
                    f"{base_url}/v1/chat/completions",
                    headers=tunnel_headers,
                    json={
                        # Только texts, без input: тело с обоими непустыми
                        # полями шлюз отвергает с 400 (проверено 31.07 20:10).
                        "model": model_id,
                        "messages": [{"role": "user", "content": "Send request"}],
                        "texts": ["ping"],
                        "kind": "query",
                    },
                )
                status, dim, reason = _classify_probe_response(resp)
                if status == _PROBE_OK:
                    reason = ""
    except Exception as e:
        status, dim, reason = _PROBE_UNKNOWN, 0, f"{type(e).__name__}: {e}"

    _embedding_probe_cache[key] = (status, dim, reason, now)
    return status, dim, reason

async def _annotate_availability(provider, rows: list, source: str) -> list:
    """Проставить строкам каталога реальную доступность (и dim).

    Прячем ТОЛЬКО заведомо нерабочие модели. Если шлюз не в форме (таймаут,
    5xx), модель остаётся в селекторе: пустой список хуже, чем список с
    моделью, которая, возможно, заработает через минуту.
    """
    targets = [r for r in rows if r.get("kind") == "embedding"]
    if not targets or not _probe_enabled():
        return rows

    semaphore = asyncio.Semaphore(_PROBE_MAX_PARALLEL)

    async def _one(row: dict) -> None:
        async with semaphore:
            status, dim, reason = await _probe_embedding_model(provider, row["name"])
        row["probe_status"] = status
        row["available"] = status != _PROBE_BAD
        if dim:
            row["dim"] = dim
        if reason:
            row["probe_note"] = reason

    await asyncio.gather(*(_one(row) for row in targets))

    bad = [(r["path"], r.get("probe_note", "")) for r in targets if r.get("probe_status") == _PROBE_BAD]
    unknown = [(r["path"], r.get("probe_note", "")) for r in targets if r.get("probe_status") == _PROBE_UNKNOWN]
    if bad:
        # Молча не выбрасываем: иначе непонятно, почему селектор поредел.
        logger.warning(
            "[RAG-CATALOG] %s: скрыты — шлюз внятно отверг модель: %s", source, bad
        )
    if unknown:
        logger.warning(
            "[RAG-CATALOG] %s: оставлены в селекторе, но проверка не удалась "
            "(состояние шлюза, не модели): %s",
            source,
            unknown,
        )
    if _hide_unavailable():
        return [r for r in rows if r.get("kind") != "embedding" or r.get("available")]
    return rows


async def _openai_compat_rag_models(
    *,
    provider_id: str,
    path_prefix: str,
    source: str,
    description: str,
    model_type: Optional[str] = None,
    rag_only: bool = False,
) -> list:
    """Модели OpenAI-совместимого провайдера (GET /v1/models) для селектора RAG.

    Список берётся из живого ```GET /v1/models``` шлюза — ничего не захардкожено.
    Эмбеддеры дополнительно проверяются пробным вектором: в селектор попадают
    только те, что реально отвечают (см. ```_probe_embedding_model```).
    """
    from backend.llm_providers.registry import get_registry

    registry = await get_registry()
    if not registry.contains(provider_id):
        logger.warning(
            "[RAG-CATALOG] провайдер %r не найден в реестре LLM — модели %s не появятся",
            provider_id,
            source,
        )
        return []
    provider = registry.get(provider_id)
    infos = await provider.list_models()
    rows: list = []
    logger.info(
        "[RAG-CATALOG] %s сырые модели: %s",
        source,
        [getattr(i, "model_id", "") for i in (infos or [])],
    )
    skipped: list = []
    for info in infos or []:
        model_id = str(getattr(info, "model_id", "") or "").strip()
        if not model_id:
            continue
        kind = _rag_model_kind(model_id, rag_only=rag_only)
        if kind is None:
            # Раньше отбрасывалось молча — и было не понять, почему селектор пуст.
            skipped.append(model_id)
            continue
        if model_type and kind != model_type:
            continue
        rows.append(
            {
                "path": f"{path_prefix}/{model_id}",
                "name": model_id,
                "display_name": model_id,
                "source": source,
                "kind": kind,
                "description": description,
                "available": True,
            }
        )
    if skipped:
        logger.info(
            "[RAG-CATALOG] %s не распознаны как RAG-модели (тип не виден по имени): %s",
            source,
            skipped,
        )
    rows = await _annotate_availability(provider, rows, source)
    logger.info("[RAG-CATALOG] %s RAG-каталог: %s", source, [r["path"] for r in rows])
    return rows


async def _phoenix_rag_models(model_type: Optional[str] = None) -> list:
    """Обратная совместимость: только Phoenix."""
    return await _openai_compat_rag_models(
        provider_id=PHOENIX_PROVIDER_ID,
        path_prefix="phoenix",
        source="phoenix",
        description="Модель Phoenix (LiteLLM)",
        model_type=model_type,
    )


async def _external_rag_models(model_type: Optional[str] = None) -> list:
    """Phoenix + CORSUR (и другие из _EXTERNAL_RAG_CATALOG). Шлюзы — параллельно."""

    async def _one(entry: dict) -> list:
        try:
            return await _openai_compat_rag_models(
                provider_id=entry["provider_id"],
                path_prefix=entry["path_prefix"],
                source=entry["source"],
                description=entry["description"],
                model_type=model_type,
                rag_only=bool(entry.get("rag_only", False)),
            )
        except Exception:
            logger.exception(
                "Каталог %s недоступен — пропускаю", entry.get("source")
            )
            return []

    parts = await asyncio.gather(*(_one(entry) for entry in _EXTERNAL_RAG_CATALOG))
    rows: list = []
    for part in parts:
        rows.extend(part)
    return rows


async def _external_rag_models_cached(model_type: Optional[str] = None) -> list:
    """Полный каталог с TTL (как /api/models/available), затем фильтр по type."""
    global _rag_models_catalog_cache, _rag_models_catalog_cache_ts

    cache_seconds = _rag_models_cache_seconds()
    now = time.monotonic()
    if (
        _rag_models_catalog_cache is not None
        and (now - _rag_models_catalog_cache_ts) < cache_seconds
        and _rag_models_catalog_cache
    ):
        rows = _rag_models_catalog_cache
    else:
        async with _rag_models_catalog_cache_lock:
            now = time.monotonic()
            if (
                _rag_models_catalog_cache is not None
                and (now - _rag_models_catalog_cache_ts) < cache_seconds
                and _rag_models_catalog_cache
            ):
                rows = _rag_models_catalog_cache
            else:
                rows = await _external_rag_models(None)
                if rows:
                    _rag_models_catalog_cache = rows
                    _rag_models_catalog_cache_ts = time.monotonic()

    if not model_type:
        return list(rows)
    return [r for r in rows if (r.get("kind") or "embedding") == model_type]


@router.get("/api/rag/models")
async def list_rag_models(
    current_user: Annotated[dict, Depends(get_current_user)],
    type: str | None = None,
    scope: Optional[str] = None,
):
    """Каталог embedding/reranker для UI: local (svc-rag-models) + CORSUR/PHOENIX.

    ```scope``` — чей выбор подсвечивать как current: project (по умолчанию) или agent.
    Внешний каталог кэшируется (RAG_MODELS_CACHE_SECONDS);
    current всегда из персональных настроек пользователя (с fallback на cluster_default).
    """
    try:
        data: dict = {
            "models": {"embedding": [], "reranker": []},
            "offline": True,
            "cluster_default": {},
        }
        # 1) Локальные папки из SVC-RAG-MODELS (models/rag/*) — основной каталог memo.
        if rag_models_client:
            try:
                local = await rag_models_client.list_models(type)
                if isinstance(local, dict):
                    data["offline"] = bool(local.get("offline", True))
                    if isinstance(local.get("cluster_default"), dict):
                        data["cluster_default"] = local["cluster_default"]
                    if isinstance(local.get("current"), dict) and not data["cluster_default"]:
                        data["cluster_default"] = local["current"]
                    local_models = local.get("models") or {}
                    for kind_key in ("embedding", "reranker"):
                        if type and kind_key != type:
                            continue
                        for row in local_models.get(kind_key) or []:
                            if not isinstance(row, dict) or not row.get("path"):
                                continue
                            row = dict(row)
                            row.setdefault("source", "local")
                            row.setdefault("kind", kind_key)
                            data["models"].setdefault(kind_key, []).append(row)
            except Exception:
                logger.exception("Каталог локальных RAG-моделей (svc-rag-models) недоступен")
        # 2) Внешние шлюзы (CORSUR / PHOENIX) — опционально, если настроены.
        try:
            external_rows = await _external_rag_models_cached(type)
            for row in external_rows or []:
                kind_key = row.get("kind") or "embedding"
                data["models"].setdefault(kind_key, []).append(row)
        except Exception:
            logger.exception("Каталог внешних RAG-моделей недоступен")
        user_id = str(current_user.get("user_id") or "").strip()
        user_rag = (
            await get_user_rag_settings(user_id, normalize_scope(scope))
            if user_id
            else {}
        )
        return _overlay_user_model_current(data, user_rag)
    except Exception as e:
        logger.exception("list_rag_models error")
        raise HTTPException(status_code=502, detail=str(e)) from e


@router.get("/api/rag/models/current")
async def get_rag_models_current(
    current_user: Annotated[dict, Depends(get_current_user)], 
    scope: Optional[str] = None,
):
    try:
        # Кластерная «текущая модель» есть только у svc-rag-models. Для шлюзовых
        # провайдеров источник истины — персональные настройки пользователя.
        data: dict = {}
        if rag_models_client:
            try:
                data = await rag_models_client.get_current()
            except Exception:
                logger.warning(
                    "[RAG-CATALOG] /models/current недоступен — отдаю только выбор пользователя",
                    exc_info=True,
                )
                data = {}
        if not isinstance(data, dict):
            data = {}
        user_id = str(current_user.get("user_id") or "").strip()
        user_rag = (
            await get_user_rag_settings(user_id, normalize_scope(scope)) 
            if user_id 
            else {}
        )
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


async def _select_external_rag_model(
    model_type: str,
    model_path: str,
    user_id: str,
    *,
    path_prefix: str,
    source_label: str,
    scope: Optional[str] = None,
):
    """Персональный выбор внешней OpenAI-совместимой модели (phoenix/…, corsur/…).

    Кластер НЕ переключаем: после B2/B3 модель едет в теле каждого запроса.
    """
    if not rag_client:
        raise HTTPException(status_code=503, detail="RAG service недоступен")
    prefix = f"{path_prefix}/"
    if not model_path.lower().startswith(prefix):
        raise HTTPException(status_code=400, detail=f"Ожидался путь {prefix}<id>")
    model_id = model_path.split("/", 1)[1].strip()
    if not model_id:
        raise HTTPException(
            status_code=400, detail=f"Пустой id модели {source_label}"
        )

    try:
        catalog = await _external_rag_models(model_type)
    except Exception as e:
        logger.exception("%s catalog error", source_label)
        raise HTTPException(status_code=502, detail=str(e)) from e
    paths = {
        str((r or {}).get("path") or "").strip()
        for r in (catalog or [])
        if str((r or {}).get("path") or "").lower().startswith(prefix)
    }
    if paths and model_path not in paths:
        raise HTTPException(
            status_code=400,
            detail=f"Модель {source_label} {model_path!r} не найдена в каталоге",
        )
    result: dict = {
        "success": True,
        "model_type": model_type,
        "model_path": model_path,
        "cluster_changed": False,
    }

    if model_type == "embedding":
        merged = await save_user_rag_settings(
            user_id, {"rag_embedding_model_path": model_path}, scope
        )
        if _reindex_on_model_change():
            asyncio.create_task(
                _run_background_reindex_for_user(
                    user_id, chunk_params_from_rag_settings(merged), scope
                )
            )
    else:
        await save_user_rag_settings(user_id, {"rag_reranker_model_path": model_path}, scope)
    bump_rag_semantic_cache()
    logger.info(
        "[RAG-CFG] персональный выбор %s user=%s type=%s path=%s "
        "(кластер и Библиотека не меняются)",
        source_label,
        user_id,
        model_type,
        model_path,
    )
    result["message"] = "Модель сохранена в ваших настройках"
    result["reindexed"] = model_type == "embedding" and _reindex_on_model_change()
    return result


async def _select_phoenix_rag_model(
    model_type: str, model_path: str, user_id: str, 
    scope: Optional[str] = None,
):
    return await _select_external_rag_model(
        model_type,
        model_path,
        user_id,
        path_prefix="phoenix",
        source_label="Phoenix",
        scope=scope,
    )


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
    user_id = str(current_user.get("user_id") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    model_type = str(body.model_type or "").strip().lower()
    if model_type not in ("embedding", "reranker"):
        raise HTTPException(status_code=400, detail="model_type должен быть embedding или reranker")
    model_path = str(body.model_path or "").strip()
    if not model_path:
        raise HTTPException(status_code=400, detail="model_path обязателен")
    scope = normalize_scope(body.scope)
    logger.debug(
        "[RAG-CFG] Выбор RAG-модели user=%s scope=%s: type=%s, path=%s",
        user_id,
        scope,
        model_type,
        model_path,
    )
    if model_path.lower().startswith("huggingface/"):
        raise HTTPException(
            status_code=400,
            detail="Источник huggingface отключён: выберите CORSUR / PHOENIX / PHOENIX_Embeddings",
        )
    if model_path.lower().startswith("phoenix_embeddings/"):
        return await _select_external_rag_model(
            model_type,
            model_path,
            user_id,
            path_prefix="phoenix_embeddings",
            source_label="PHOENIX_Embeddings",
            scope=scope,
        )
    if model_path.lower().startswith("phoenix/"):
        return await _select_external_rag_model(
            model_type,
            model_path,
            user_id,
            path_prefix="phoenix",
            source_label="PHOENIX",
            scope=scope,
        )
    if model_path.lower().startswith("corsur/"):
        return await _select_external_rag_model(
            model_type,
            model_path,
            user_id,
            path_prefix="corsur",
            source_label="CORSUR",
            scope=scope,
        )
    # local/* — нужен svc-rag-models
    require_service("rag_models")
    if not rag_models_client:
        raise HTTPException(status_code=503, detail="RAG-models service недоступен")
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
                user_id, {"rag_embedding_model_path": model_path}, scope
            )
            if _reindex_on_model_change():
                logger.info(
                    "[REINDEX-USER] смена embedding user=%s scope=%s → scoped reindex (без Memory)",
                    user_id,
                    scope,
                )
                asyncio.create_task(
                    _run_background_reindex_for_user(
                        user_id, chunk_params_from_rag_settings(merged), scope
                    )
                )
        else:
            await save_user_rag_settings(
                user_id, {"rag_reranker_model_path": model_path}, scope
            )
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
        user_rag = (
            await get_user_rag_settings(settings_user, "agent") if settings_user else {}
        )
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
                prefix="memrag*",
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
                    file_object_name = minio_client.generate_object_name(prefix="memrag*", extension=ext)
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

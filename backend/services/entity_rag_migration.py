"""
Разовый перенос RAG-настроек из ``user_llm_settings`` к агентам и проектам.

Здесь же — чтение СТАРОГО трёхэтажного формата. Держим его отдельно от
``user_rag_settings``, чтобы удалить обе части одним куском, когда легаси-данные
перестанут быть нужны (см. «Что осталось» в плане).

Переносим не «полку» записи, а ИТОГ. Старый порядок слияния:

    дефолты кластера → корень записи → scopes.<scope> → entities.<scope>.<id>

Агент без записи в ``entities`` жил не на дефолтах, а на ``scopes.agent``
автора — и его корпус нарезан и векторизован именно этими значениями. Перенос
одного ``entities`` откатил бы такого агента на дефолты кластера, он полез бы в
чужую таблицу размерности и перестал бы искать.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Tuple

from backend.settings.logging import get_logger

logger = get_logger(__name__)

_SCOPES_FIELD = "scopes"
_ENTITIES_FIELD = "entities"

# Ключи старого формата, которые лежали в scopes.<scope>. Список зафиксирован
# намеренно: он описывает данные на диске, а не сегодняшний набор настроек, и
# меняться вместе с ним не должен.
_LEGACY_SCOPED_KEYS: Tuple[str, ...] = (
    "rag_memory_strategy",
    "rag_chunking_strategy",
    "rag_chunk_size",
    "rag_chunk_overlap",
    "rag_embedding_model_path",
    "rag_reranker_model_path",
    "rag_system_prompt",
    "rag_chat_top_k",
    "rag_similarity_threshold",
    "rag_reranking_enabled",
    "rag_rerank_top_n",
)


def _force_requested() -> bool:
    return (os.getenv("RAG_ENTITY_SETTINGS_MIGRATE", "").strip().lower()) == "force"


def legacy_effective_settings(
    stored: Optional[Dict[str, Any]],
    scope: str,
    entity_id: str,
    setting_keys: Tuple[str, ...],
) -> Dict[str, Any]:
    """Что старый код отдавал для этой сущности прямо сейчас.

    Повторяет ``_merge_entity`` прежней версии ``user_rag_settings``: корень,
    затем скоуп, затем запись сущности. Дефолты кластера сюда не подмешиваются —
    их накладывает вызывающий, чтобы можно было отличить «задано» от «не задано».
    """
    out: Dict[str, Any] = {}
    if not isinstance(stored, dict):
        return out

    # 1. Общие ключи и легаси-плоские значения из корня записи.
    for key in setting_keys:
        if key in stored and stored[key] is not None:
            out[key] = stored[key]

    # 2. Значения скоупа перекрывают корень.
    # Форму не предполагаем: записи правили руками, а падение на одной строке
    # оставило бы БЕЗ переноса вообще все сущности.
    scopes = stored.get(_SCOPES_FIELD)
    scoped = scopes.get(scope) if isinstance(scopes, dict) else None
    if isinstance(scoped, dict):
        for key in _LEGACY_SCOPED_KEYS:
            if key in scoped and scoped[key] is not None:
                out[key] = scoped[key]

    # 3. Запись самой сущности перекрывает всё.
    entities = stored.get(_ENTITIES_FIELD)
    scoped_entities = entities.get(scope) if isinstance(entities, dict) else None
    if isinstance(scoped_entities, dict):
        entity_data = scoped_entities.get(str(entity_id))
        if isinstance(entity_data, dict):
            for key in setting_keys:
                if key in entity_data and entity_data[key] is not None:
                    out[key] = entity_data[key]
    return out


def _differs_from_defaults(
    snapshot: Dict[str, Any], defaults: Dict[str, Any], setting_keys: Tuple[str, ...]
) -> Dict[str, Any]:
    """Только те ключи, где сущность реально расходится с дефолтами кластера.

    Совпало всё — возвращаем пустой словарь, и строка не заводится: такая
    сущность продолжает следовать за ConfigMap, как до правки. Замораживать
    всех подряд нельзя, иначе правка дефолтов перестанет доезжать до кого-либо.
    """
    out: Dict[str, Any] = {}
    for key in setting_keys:
        if key not in snapshot:
            continue
        if snapshot[key] != defaults.get(key):
            out[key] = snapshot[key]
    return out


async def migrate_user_settings_to_entities(repo) -> None:
    """Перенос. Идемпотентен по отметке в ``backend_data_migrations``."""
    from backend.database.postgresql.entity_settings_repository import (
        SCOPE_AGENT,
        SCOPE_PROJECT,
    )

    if _force_requested():
        logger.warning(
            "[RAG-CFG-MIGRATE] RAG_ENTITY_SETTINGS_MIGRATE=force — переносим заново"
        )
        await repo.clear_migration_mark()
    elif await repo.migration_applied():
        logger.info("[RAG-CFG-MIGRATE] перенос уже выполнялся — пропускаем")
        return

    from backend.services.user_rag_settings import (
        RAG_SETTING_KEYS,
        default_rag_settings_snapshot,
    )

    agents, projects = await repo.owners_snapshot()
    if not agents and not projects:
        logger.info("[RAG-CFG-MIGRATE] агентов и проектов нет — переносить нечего")
        await repo.mark_migration({"agents": 0, "projects": 0})
        return

    defaults = default_rag_settings_snapshot()
    user_settings_repo = _get_user_settings_repo()
    if user_settings_repo is None:
        logger.warning("[RAG-CFG-MIGRATE] user_llm_settings недоступен — переноса не будет")
        return

    # Строк пользователей заметно меньше, чем сущностей: читаем каждую один раз.
    cache: Dict[str, Dict[str, Any]] = {}

    async def _stored_for(owner: str) -> Dict[str, Any]:
        if owner not in cache:
            row = await user_settings_repo.get(owner)
            raw = (row or {}).get("rag_settings")
            cache[owner] = raw if isinstance(raw, dict) else {}
        return cache[owner]

    rows: List[Tuple[str, str, Dict[str, Any], Optional[str]]] = []
    stats = {"agent_moved": 0, "agent_default": 0, "project_moved": 0, "project_default": 0}

    for scope, pairs, moved_key, default_key in (
        (SCOPE_AGENT, agents, "agent_moved", "agent_default"),
        (SCOPE_PROJECT, projects, "project_moved", "project_default"),
    ):
        for entity_id, owner in pairs:
            stored = await _stored_for(owner)
            snapshot = legacy_effective_settings(stored, scope, entity_id, RAG_SETTING_KEYS)
            payload = _differs_from_defaults(snapshot, defaults, RAG_SETTING_KEYS)
            if payload:
                rows.append((scope, entity_id, payload, owner))
                stats[moved_key] += 1
            else:
                stats[default_key] += 1

    inserted = await repo.insert_missing(rows)
    dropped = await repo.count_foreign_entity_copies()

    logger.info(
        "[RAG-CFG-MIGRATE] перенесено agent=%s project=%s, "
        "оставлено на дефолтах agent=%s project=%s, отброшено чужих копий=%s",
        stats["agent_moved"],
        stats["project_moved"],
        stats["agent_default"],
        stats["project_default"],
        dropped,
    )
    if inserted != len(rows):
        logger.info(
            "[RAG-CFG-MIGRATE] часть строк уже существовала: подготовлено %s, вставлено %s",
            len(rows),
            inserted,
        )
    await repo.mark_migration({**stats, "inserted": inserted, "dropped_foreign": dropped})


def _get_user_settings_repo():
    try:
        from backend.database.init_db import get_user_settings_repository

        return get_user_settings_repository()
    except Exception:
        logger.debug("[RAG-CFG-MIGRATE] user settings repository недоступен", exc_info=True)
        return None

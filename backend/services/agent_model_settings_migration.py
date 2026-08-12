"""
Разовая уборка ```config.model_settings``` у агентов, которым их никто не задавал.

Конструктор агента писал полный набор настроек генерации ВСЕГДА — даже если
человек ни разу не открывал «Тонкую настройку». Значения при этом брались из
хардкода фронтенда (```MODEL_SETTINGS_DEFAULT```), одного на все агенты. На бэкенде
непустой ```model_settings``` карточки отменял персональные настройки пользователя
целиком, поэтому «Настройки → Модели» не применялись ни к одному агенту, а сами
агенты выглядели одинаково настроенными.

Правка в ```user_llm_settings.enrich_agent_profile_with_user_settings``` чинит это
для будущих записей: карточка перекрывает персональные настройки поключево. Но у
УЖЕ СОЗДАННЫХ агентов заполнены все ключи, и перекрывать они продолжат всё.
Отсюда эта уборка: снимаем ```model_settings``` там, где он совпадает с дефолтами —
такой агент возвращается к «следую за настройками пользователя и кластера».

Сравниваем с двумя снимками:

* ```_CONSTRUCTOR_DEFAULT``` — что писал конструктор. Список зафиксирован намеренно:
он описывает данные на диске, а не сегодняшний набор настроек, и меняться
вместе с ним не должен.
* дефолты кластера (```llm_settings.json```) — на случай, если в контуре они свои.

Логика «оставляем запись, только если она отличается от дефолтов» — та же, что в
переносе RAG-настроек (```entity_rag_migration```): замораживать всех подряд нельзя,
иначе правка дефолтов перестанет доезжать до кого-либо.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

from backend.settings.logging import get_logger

logger = get_logger(__name__)

MIGRATION_NAME = "agent_model_settings_default_v1"

# Своё число для pg_advisory_xact_lock — не пересекается с 774_120_001 у переноса
# RAG-настроек. Реплик backend несколько, стартуют одновременно.
_MIGRATION_LOCK_ID = 774_120_002

# Ровно то, что писал конструктор агента (frontend MODEL_SETTINGS_DEFAULT).
_CONSTRUCTOR_DEFAULT: Dict[str, Any] = {
    "context_size": 100000,
    "output_tokens": 50000,
    "temperature": 0.7,
    "top_p": 0.95,
    "repeat_penalty": 1.05,
    "top_k": 40,
    "min_p": 0.05,
    "frequency_penalty": 0.0,
    "presence_penalty": 0.0,
    "use_gpu": False,
    "streaming": True,
    "streaming_speed": 20,
}

# Ключ есть в карточке, но настройкой генерации не является: конструктор пишет
# его вместе с остальными, а на скорость печати в интерфейсе он и влияет.
_IGNORED_KEYS = ("streaming_speed",)

def _force_requested() -> bool:
    return (os.getenv("AGENT_MODEL_SETTINGS_MIGRATE", "").strip().lower()) == "force"

def _as_dict(value: Any) -> Optional[Dict[str, Any]]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return None
    return None

def _same_value(left: Any, right: Any) -> bool:
    """Сравнение значения настройки с дефолтом.

    JSONB отдаёт числа как int/float, и 0.7 из базы может не совпасть с 0.7 из
    кода побайтово. Булевы сравниваем отдельно: в Python ```True == 1```, и без
    этого ```use_gpu: 1``` сошлось бы с ```True```.
    """
    if isinstance(left, bool) or isinstance(right, bool):
        return isinstance(left, bool) and isinstance(right, bool) and left is right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return abs(float(left) - float(right)) < 1e-9
    return left == right

def matches_defaults(stored: Dict[str, Any], defaults: Dict[str, Any]) -> bool:
    """True, если в карточке нет ни одного значения, отличного от дефолтов.

    Ключи, которых в снимке дефолтов нет, игнорируем: набор настроек со временем
    менялся, и лишний ключ из старой версии не должен считаться «своей»
    настройкой.
    """
    for key, value in stored.items():
        if key in _IGNORED_KEYS or key not in defaults:
            continue
        if not _same_value(value, defaults[key]):
            return False
    return True

async def _ensure_marks_table(conn) -> None:
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS backend_data_migrations (
            name       VARCHAR(128) PRIMARY KEY,
            applied_at TIMESTAMP DEFAULT NOW(),
            details    JSONB DEFAULT '{}'::jsonb
        )
        """)

async def cleanup_default_agent_model_settings(agent_repo) -> None:
    """Уборка. Идемпотентна по отметке в ```backend_data_migrations```.

    Отметка обязательна: ```create_tables``` зовётся на каждом старте, а человек
    мог осознанно выставить агенту значения, совпадающие с дефолтами, уже ПОСЛЕ
    выката. Второй прогон снёс бы их.
    """
    if agent_repo is None:
        logger.warning(
            "[LLM-CFG-MIGRATE] репозиторий агентов недоступен — уборки не будет"
        )
        return

    from backend.utils.llm_defaults import llm_settings_defaults

    cluster_defaults = llm_settings_defaults()

    try:
        async with await agent_repo.db_connection.acquire() as conn:
            async with conn.transaction():
                await _ensure_marks_table(conn)
                await conn.execute(
                    "SELECT pg_advisory_xact_lock($1)", _MIGRATION_LOCK_ID
                )

                if _force_requested():
                    logger.warning(
                        "[LLM-CFG-MIGRATE] AGENT_MODEL_SETTINGS_MIGRATE=force — убираем заново"
                    )
                    await conn.execute(
                        "DELETE FROM backend_data_migrations WHERE name = $1",
                        MIGRATION_NAME,
                    )
                else:
                    row = await conn.fetchrow(
                        "SELECT applied_at FROM backend_data_migrations WHERE name = $1",
                        MIGRATION_NAME,
                    )
                    if row is not None:
                        logger.info(
                            "[LLM-CFG-MIGRATE] уборка уже выполнялась — пропускаем"
                        )
                        return

                rows = await conn.fetch(
                    "SELECT id, config FROM agents WHERE config ? 'model_settings'"
                )

                to_clear: List[int] = []
                kept = 0
                unreadable = 0
                for record in rows:
                    config = _as_dict(record["config"])
                    if config is None:
                        unreadable += 1
                        continue
                    stored = _as_dict(config.get("model_settings"))
                    if stored is None:
                        # model_settings есть, но это не объект — чинить нечего,
                        # такую карточку бэкенд и так игнорирует.
                        to_clear.append(int(record["id"]))
                        continue
                    if matches_defaults(
                        stored, _CONSTRUCTOR_DEFAULT
                    ) or matches_defaults(stored, cluster_defaults):
                        to_clear.append(int(record["id"]))
                    else:
                        kept += 1

                if to_clear:
                    await conn.execute(
                        "UPDATE agents SET config = config - 'model_settings' WHERE id = ANY($1::int[])",
                        to_clear,
                    )

                await conn.execute(
                    """
                    INSERT INTO backend_data_migrations (name, details)
                    VALUES ($1, $2::jsonb)
                    ON CONFLICT (name) DO UPDATE SET
                        details = EXCLUDED.details,
                        applied_at = NOW()
                    """,
                    MIGRATION_NAME,
                    json.dumps(
                        {
                            "cleared": len(to_clear),
                            "kept": kept,
                            "unreadable": unreadable,
                        },
                        ensure_ascii=False,
                    ),
                )

        logger.info(
            "[LLM-CFG-MIGRATE] снято настроек-дефолтов у агентов: %s, оставлено своих: %s%s",
            len(to_clear),
            kept,
            f", нечитаемых config: {unreadable}" if unreadable else "",
        )
    except Exception:
        # Уборка не должна ронять старт: без неё старые агенты просто продолжат
        # жить на своих копиях дефолтов, как жили до выката.
        logger.exception("[LLM-CFG-MIGRATE] уборка настроек агентов не выполнена")
"""Заводские значения LLM-настроек — единый источник правды.

Читаются из seed-файла ```llm_settings.json``` (read-only шаблон из образа, см.
```llm_settings_seed_paths```). 

Это **только дефолты**. Персональные настройки пользователя лежат в PostgreSQL
(```user_llm_settings.model_settings```) и накладываются поверх — см.
```user_llm_settings._merge_model_settings```.

Сюда же уехали максимумы: блок ```_max_values``` в том же json. Ключи с ведущим ```_```
настройками не считаются и в writable-файл не пишутся.
"""

from __future__ import annotations

import json
from typing import Any, Dict

from backend.settings.logging import get_logger
from backend.utils.safe_paths import llm_settings_seed_paths

logger = get_logger(__name__)

MAX_VALUES_KEY = "_max_values"

# Последний рубеж: если seed-файла нет вообще (например, урезанный образ).
_FALLBACK_DEFAULTS: Dict[str, Any] = {
    "context_size": 100000,
    "output_tokens": 50000,
    "batch_size": 512,
    "n_threads": 12,
    "use_mmap": True,
    "use_mlock": False,
    "verbose": True,
    "temperature": 0.7,
    "top_p": 0.95,
    "repeat_penalty": 1.05,
    "top_k": 40,
    "min_p": 0.05,
    "frequency_penalty": 0.0,
    "presence_penalty": 0.0,
    "use_gpu": False,
    "streaming": True,
    "legacy_api": False,
}

_FALLBACK_MAX_VALUES: Dict[str, Any] = {
    "context_size": 200000,
    "output_tokens": 100000,
    "batch_size": 2048,
    "n_threads": 24,
    "temperature": 2.0,
    "top_p": 1.0,
    "repeat_penalty": 2.0,
    "top_k": 200,
    "min_p": 1.0,
    "frequency_penalty": 2.0,
    "presence_penalty": 2.0,
}

_cache: Dict[str, Dict[str, Any]] | None = None

def is_settings_key(key: str) -> bool:
    """Служебные ключи (```_max_values``` и прочие с подчёркиванием) настройками не являются."""
    return not str(key).startswith("_")

def _read_seed() -> Dict[str, Any]:
    """Первый существующий seed-файл. Пустой словарь, если ни одного нет."""
    for path in llm_settings_seed_paths():
        if not path.is_file():
            continue
        try:
            with path.open("r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                logger.info("LLM-дефолты прочитаны из %s", path)
                return data
            logger.warning("LLM-дефолты: %s не словарь, пропускаю", path)
        except Exception:
            logger.exception("LLM-дефолты: не удалось прочитать %s", path)
    logger.warning("LLM-дефолты: seed-файл не найден, беру встроенные значения")
    return {}

def _build() -> Dict[str, Dict[str, Any]]:
    seed = _read_seed()

    defaults = dict(_FALLBACK_DEFAULTS)
    for key, value in seed.items():
        if is_settings_key(key) and key in defaults and value is not None:
            defaults[key] = value

    max_values = dict(_FALLBACK_MAX_VALUES)
    seed_max = seed.get(MAX_VALUES_KEY)
    if isinstance(seed_max, dict):
        for key, value in seed_max.items():
            if key in max_values and value is not None:
                max_values[key] = value

    # Максимум не может быть ниже дефолта — иначе слайдер в UI обрежет заводское значение.
    for key, cap in list(max_values.items()):
        default_value = defaults.get(key)
        if isinstance(default_value, (int, float)) and isinstance(cap, (int, float)):
            if default_value > cap:
                logger.warning(
                    "LLM-дефолты: max %s=%s ниже дефолта %s — поднимаю максимум",
                    key,
                    cap,
                    default_value,
                )
                max_values[key] = default_value

    return {"defaults": defaults, "max_values": max_values}

def _cached() -> Dict[str, Dict[str, Any]]:
    global _cache
    if _cache is None:
        _cache = _build()
    return _cache

def llm_settings_defaults() -> Dict[str, Any]:
    """Заводские значения настроек модели (копия — вызывающий волен менять)."""
    return dict(_cached()["defaults"])

def llm_settings_max_values() -> Dict[str, Any]:
    """Верхние границы для UI. Гарантированно не ниже дефолтов."""
    return dict(_cached()["max_values"])

def reload_llm_defaults() -> Dict[str, Dict[str, Any]]:
    """Перечитать seed-файл (для тестов и горячей правки)."""
    global _cache
    _cache = None
    return _cached()
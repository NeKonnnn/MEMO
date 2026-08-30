"""Фильтрация списка моделей для UI (/api/models/available)."""

from __future__ import annotations

import re
from typing import Dict, List, Set

from backend.settings import get_settings
from backend.settings.logging import get_logger

from .base import LLMProviderConfig, ModelInfo

logger = get_logger(__name__)


def model_health_filter_enabled(config: LLMProviderConfig) -> bool:
    """Вкл/выкл фильтра. ENV: MODEL_HEALTH_FILTER_ENABLED, extra.filter_unhealthy_models.

    У шлюза RAG-моделей ('extra.rag_gateway: true') фильтр по умолчанию
    выключен: он проверяет модель запросом 'POST /v1/chat/completions' и
    ждёт 'choices' в ответе. Эмбеддер их не отдаёт — его вектор шлюз
    возвращает в своей форме, — поэтому живой 'embed/FRIDA' считался
    нездоровым и пропадал из RAG-селектора. Годность эмбеддера проверяет
    пробный вектор в 'routes/rag.py' ('_probe_embedding_model'), и это
    единственная осмысленная проверка для такого провайдера.

    Явный 'filter_unhealthy_models' в конфиге по-прежнему сильнее.
    """
    if not get_settings().model_health.filter_enabled:
        return False
    extra = config.extra or {}
    if "filter_unhealthy_models" in extra:
        return bool(extra["filter_unhealthy_models"])
    if bool(extra.get("rag_gateway")) or bool(getattr(config, "rag_gateway", False)):
        return False
    return True


def model_health_probe_max(config: LLMProviderConfig) -> int:
    """Сколько моделей проверять chat-probe. ENV: MODEL_HEALTH_PROBE_MAX."""
    extra = config.extra or {}
    if "per_model_health_max" in extra:
        try:
            return max(1, int(extra["per_model_health_max"]))
        except (TypeError, ValueError):
            pass
    return get_settings().model_health.probe_max


def _normalize_model_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").strip().lower())


def model_id_matches_any(model_id: str, names: Set[str]) -> bool:
    """Сопоставление model_id с именами из LiteLLM health (fuzzy)."""
    mid = (model_id or "").strip()
    if not mid or not names:
        return False
    if mid in names:
        return True
    mid_norm = _normalize_model_key(mid)
    for name in names:
        if not name:
            continue
        if name == mid:
            return True
        if name.endswith("/" + mid) or name.endswith("\\" + mid):
            return True
        if mid.endswith("/" + name) or mid.endswith("\\" + name):
            return True
        tail = name.split("/")[-1]
        if tail == mid or mid.split("/")[-1] == name:
            return True
        if _normalize_model_key(name) == mid_norm:
            return True
        if _normalize_model_key(tail) == mid_norm:
            return True
    return False


def unhealthy_names_from_litellm_payload(payload: Dict) -> Set[str]:
    names: Set[str] = set()
    endpoints = payload.get("unhealthy_endpoints")
    if not isinstance(endpoints, list):
        return names
    for ep in endpoints:
        if not isinstance(ep, dict):
            continue
        model = ep.get("model") or ep.get("model_name") or ep.get("model_id")
        if model:
            name = str(model).strip()
            if name:
                names.add(name)
    return names


def keep_models_if_empty(
    original: List[ModelInfo],
    filtered: List[ModelInfo],
    *,
    provider_id: str,
    reason: str,
) -> List[ModelInfo]:
    """Не скрываем весь каталог — иначе UI остаётся без моделей."""
    if original and not filtered:
        logger.warning(
            "[%s] health-filter: %s отсеяло все %d моделей — показываем без фильтра",
            provider_id,
            reason,
            len(original),
        )
        return original
    return filtered


def exclude_models_by_names(
    models: List[ModelInfo],
    exclude: Set[str],
    *,
    provider_id: str,
) -> List[ModelInfo]:
    if not exclude:
        return models
    filtered = [m for m in models if not model_id_matches_any(m.model_id, exclude)]
    if len(filtered) != len(models):
        logger.info(
            "[%s] batch unhealthy: модели %d → %d (скрыто %d)",
            provider_id,
            len(models),
            len(filtered),
            len(models) - len(filtered),
        )
    return keep_models_if_empty(models, filtered, provider_id=provider_id, reason="batch unhealthy")


def filter_models_by_chat_probe(
    models: List[ModelInfo],
    probed: Dict[str, bool],
    *,
    provider_id: str,
) -> List[ModelInfo]:
    """Оставляем модели с probed[id]=True; не проверенные (лимит probe) — тоже оставляем."""
    kept: List[ModelInfo] = []
    for model in models:
        mid = (model.model_id or "").strip()
        if not mid:
            continue
        status = probed.get(mid)
        if status is None or status:
            kept.append(model)
    if len(kept) != len(models):
        logger.info(
            "[%s] chat-probe: модели %d → %d (скрыто %d)",
            provider_id,
            len(models),
            len(kept),
            len(models) - len(kept),
        )
    return keep_models_if_empty(
        models, kept, provider_id=provider_id, reason="chat-probe"
    )

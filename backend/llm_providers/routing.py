"""Маршрутизация LLM: ProviderRegistry vs legacy llm-svc (B-27)."""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List, Optional

import httpx

from backend.settings.logging import get_logger

logger = get_logger(__name__)


def should_use_llm_svc_direct(*, model_path: Optional[str] = None, images: Optional[List[Any]] = None) -> bool:
    """
    True → ``ask_agent_llm_svc`` / ``generate_response`` (legacy llm-svc HTTP, vision).

    - Изображения: только llm-svc path (vision в generate_response).
    - ``llm-svc://…``: legacy URI — полная логика host/swap в llm_client.
    """
    if images:
        return True
    raw = str(model_path or "").strip().lower()
    if raw.startswith("llm-svc://"):
        return True
    return False


def registry_response_usable(response: Optional[str]) -> bool:
    if response is None:
        return False
    return bool(str(response).strip())


# Тексты, которые ask_agent и format_llm_http_error возвращают ВМЕСТО ответа
# модели — с точки зрения вызывающего кода это обычная строка, исключения нет.
# Для чата так и надо: пользователю показывают понятную причину. Но для служебных
# вызовов (суммаризация при индексации, HyDE, multi-query, исправление опечаток)
# такая строка — яд: 01.08 она попала и в поисковый запрос, и в индекс как
# содержимое чанков («Ошибка LLM (HTTP 422)» вместо summary документа).
_LLM_ERROR_MARKERS = (
    "ошибка llm (http",
    "не удалось получить ответ от модели",
    "ошибка при обращении к модели",
    "сервис llm недоступен",
    "модель не загружена на стороне провайдера",
    "запрос не помещается в контекстное окно модели",
)


def _env_flag(name: str, default: bool) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    return raw not in ("0", "false", "no", "off")


def service_thinking_disabled() -> bool:
    """Отключать ли мышление для служебных вызовов. LLM_SERVICE_DISABLE_THINKING=0 — не отключать."""
    return _env_flag("LLM_SERVICE_DISABLE_THINKING", True)


def service_min_max_tokens() -> int:
    """Нижняя граница max_tokens для служебных вызовов. LLM_SERVICE_MIN_MAX_TOKENS.

    Страховка на случай, если шлюз не понимает выключатель мышления: с
    reasoning-моделью 256 токенов уходят на рассуждение целиком, и ответа
    не остаётся.
    """
    raw = (os.getenv("LLM_SERVICE_MIN_MAX_TOKENS") or "").strip()
    try:
        return max(0, min(int(raw), 32000)) if raw else 1024
    except ValueError:
        return 1024


def thinking_request_extra(enable_thinking: bool) -> Dict[str, Any]:
    """Поля запроса для включения/выключения мышления у reasoning-моделей.

    UI «Быстрый» → False, «Мышление» → True.

    Адаптация под memo_new_api:
    - ``enable_thinking`` (top-level) — читает наш llm-svc / llama.cpp schemas;
    - ``chat_template_kwargs.enable_thinking`` — vLLM/Qwen3 и внешние шлюзы
      (как в GPB_ASTRA). Оба поля шлём сразу, чтобы работало и локально, и через registry.
    """
    flag = bool(enable_thinking)
    return {
        "enable_thinking": flag,
        "chat_template_kwargs": {"enable_thinking": flag},
    }


def is_thinking_requested(request_extra: Optional[Dict[str, Any]]) -> bool:
    """True, если в request_extra явно включено мышление."""
    if not request_extra:
        return False
    if "enable_thinking" in request_extra:
        return bool(request_extra.get("enable_thinking"))
    ctk = request_extra.get("chat_template_kwargs")
    if isinstance(ctk, dict) and "enable_thinking" in ctk:
        return bool(ctk.get("enable_thinking"))
    return False


def service_call_request_extra() -> Dict[str, Any]:
    """Поля запроса, выключающие мышление у reasoning-моделей.

    Служебным вызовам (исправление опечаток, multi-query, HyDE, суммаризация
    при индексации, judge) рассуждение не нужно: их ответ читает код, а не
    человек. Хуже того, оно вредит — модель тратит бюджет токенов на
    рассуждение, до ответа не доходит, и вызывающий получает пустую строку
    (01.08: так подменился поисковый запрос).

    Если шлюз не понимает и это — ``LLM_SERVICE_DISABLE_THINKING=0``,
    и останется только страховка по ``max_tokens``.
    """
    if not service_thinking_disabled():
        return {}
    return thinking_request_extra(False)


def is_llm_error_text(text: Optional[str]) -> bool:
    """Строка — это сообщение об ошибке LLM, а не ответ модели.

    Служебные вызовы обязаны проверять результат этой функцией и вести себя как
    при сбое: пропускать шаг, а не подставлять текст ошибки в запрос или индекс.
    """
    s = str(text or "").strip().lower()
    if not s:
        return False
    return any(marker in s[:200] for marker in _LLM_ERROR_MARKERS)


def format_llm_http_error(exc: httpx.HTTPStatusError) -> str:
    """Человекочитаемая ошибка LLM API (контекст, 503, пр.)."""
    status = exc.response.status_code
    body = ""
    detail = ""
    try:
        body = (exc.response.text or "")[:800]
        payload = exc.response.json()
        if isinstance(payload, dict):
            detail = str(payload.get("detail") or payload.get("message") or payload.get("error") or "")
    except Exception:
        detail = body[:300]

    haystack = f"{detail} {body}".lower()
    if status == 400 and any(
        token in haystack
        for token in ("context", "token", "length", "maximum", "max_model", "prompt is too long", "too long")
    ):
        return (
            "Запрос не помещается в контекстное окно модели: сумма входного текста и max_tokens "
            "(output_tokens) превышает лимит. Уменьшите файл, сократите max_tokens или историю чата."
            + (f" ({detail[:240]})" if detail else "")
        )
    if status == 503:
        if "not loaded" in haystack or "не загруж" in haystack:
            return "Модель не загружена на стороне провайдера (503). Проверьте доступность модели."
        return "Сервис LLM недоступен (503). Повторите запрос через несколько секунд."
    if detail:
        return f"Ошибка LLM (HTTP {status}): {detail[:400]}"
    try:
        return f"Ошибка LLM (HTTP {status}): {json.dumps(exc.response.json(), ensure_ascii=False)[:400]}"
    except Exception:
        return f"Ошибка LLM (HTTP {status}): {body[:400] or exc}"


def build_chat_messages(
    prompt: str, *, history: Optional[List[Dict[str, Any]]] = None, system_prompt: Optional[str] = None
) -> List[Dict[str, Any]]:
    messages: List[Dict[str, Any]] = []
    if system_prompt and str(system_prompt).strip():
        messages.append({"role": "system", "content": str(system_prompt).strip()})
    for entry in history or []:
        role = str(entry.get("role") or "").strip()
        content = entry.get("content")
        if role in ("user", "assistant", "system") and content is not None:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": prompt})
    return messages


async def describe_llm_routes() -> dict:
    """Диагностика: какие провайдеры в registry (для /api/system/status)."""
    try:
        from backend.llm_providers import get_registry

        registry = await get_registry()
        providers = []
        for p in registry.all():
            providers.append(
                {
                    "id": p.id,
                    "kind": p.kind,
                    "enabled": p.enabled,
                    "function_calling": p.supports_native_function_calling(),
                    "mcp_mode": p.mcp_tool_calling_mode(),
                }
            )
        return {
            "default_provider": registry.default_id,
            "providers": providers,
            "legacy_llm_svc_direct": "llm-svc:// URIs and vision (images) use ask_agent_llm_svc",
            "mcp_agent_loop": "always ProviderRegistry",
        }
    except Exception as exc:
        logger.exception("Ошибка операции")
        return {"error": str(exc)}

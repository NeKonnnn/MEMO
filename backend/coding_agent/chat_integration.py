"""Интеграция coding agent в chat pipeline."""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, List, Optional

from backend.coding_agent.loop import (
    CodingLoopResult,
    _ensure_model_loaded,
    build_coding_system_prompt,
    get_coding_agent_loop,
)
from backend.coding_agent.workspace import validate_workspace
from backend.llm_providers.routing import thinking_request_extra
from backend.mcp.resolvers import build_chat_messages
from backend.settings.config import get_settings
from backend.settings.logging import get_logger

log = get_logger(__name__)


def coding_agent_enabled() -> bool:
    cfg = get_settings()
    coding = getattr(cfg, "coding_agent", None)
    if coding is None:
        return True
    return bool(getattr(coding, "enabled", True))


async def run_coding_for_chat(
    *,
    user_message: str,
    history: Optional[List[Dict[str, Any]]],
    system_prompt: Optional[str],
    model_path: str,
    workspace_path: str,
    plan_mode: bool = False,
    approved_plan: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 4096,
    enable_thinking: bool = False,
    emit_event: Optional[Callable[[Dict[str, Any]], Awaitable[None]]] = None,
    max_rounds: Optional[int] = None,
) -> Optional[CodingLoopResult]:
    """
    Точка входа coding agent для Socket.IO / REST.
    Возвращает None только если coding_agent выключен в конфиге.
    """
    if not coding_agent_enabled():
        return None

    validation = validate_workspace(workspace_path)
    if not validation.ok or not validation.path:
        msg = validation.error or "Некорректный workspace"
        if emit_event:
            await emit_event({"type": "error", "error": msg})
        return CodingLoopResult(
            content=f"Coding agent: {msg}. Задайте путь к workspace в проекте (шестерёнка → Coding).",
            workspace="",
            plan_mode=plan_mode,
            mode="coding_invalid_workspace",
        )

    if not await _ensure_model_loaded(model_path):
        return CodingLoopResult(
            content="Coding agent: модель недоступна для function calling.",
            workspace=validation.path,
            plan_mode=plan_mode,
            mode="coding_model_unavailable",
        )

    eff_system = build_coding_system_prompt(
        system_prompt,
        workspace=validation.path,
        plan_mode=plan_mode,
        model_path=model_path,
        approved_plan=approved_plan,
    )
    messages = build_chat_messages(
        user_message=user_message,
        history=history,
        system_prompt=eff_system,
    )
    request_extra = thinking_request_extra(bool(enable_thinking))
    loop = get_coding_agent_loop()
    return await loop.run(
        messages=messages,
        model_path=model_path,
        workspace=validation.path,
        plan_mode=plan_mode,
        approved_plan=approved_plan,
        temperature=temperature,
        max_tokens=max(max_tokens, 4096),
        request_extra=request_extra,
        event_callback=emit_event,
        max_rounds=max_rounds,
    )

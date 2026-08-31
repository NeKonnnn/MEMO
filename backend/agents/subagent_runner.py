"""Запуск изолированного субагента (без RAG родителя)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from backend.agents.config import resolve_recursion_limit
from backend.agents.subagents import (
    AgentSubagentsConfig,
    SubagentRunContext,
    build_subagent_tools,
    load_subagent_agent_names,
    subagents_from_profile,
)
from backend.realtime.helpers import _resolve_agent_chat_params, agent_mcp_tool_ids
from backend.settings.logging import get_logger

log = get_logger(__name__)


async def run_isolated_subagent(
    *,
    target_agent_id: int,
    prompt: str,
    parent_profile: Dict[str, Any],
    user: Optional[dict],
    user_id: Optional[str],
    depth: int,
    remaining_steps: int,
    history: Optional[List[Dict[str, Any]]] = None,
    enable_thinking: bool = False,
    emit_event=None,
) -> str:
    """Выполнить дочернего агента в изолированном контексте и вернуть итог."""
    child_profile = await _resolve_agent_chat_params(target_agent_id, user_id, user=user)
    if not child_profile.get("model_path"):
        return f"Subagent {target_agent_id}: model is not configured."
    model_path = str(child_profile["model_path"])
    system_prompt = child_profile.get("system_prompt") or ""
    sub_cfg = subagents_from_profile(child_profile)
    child_limit = min(remaining_steps, resolve_recursion_limit(child_profile))
    child_limit = max(1, child_limit)

    tool_ids = agent_mcp_tool_ids(child_profile)
    names = await load_subagent_agent_names(sub_cfg.agent_ids, user_id=user_id)
    if child_profile.get("name"):
        names[int(target_agent_id)] = str(child_profile["name"])
    native_tools = build_subagent_tools(
        sub_cfg,
        parent_agent_id=child_profile.get("agent_id"),
        agent_names=names,
    )

    messages: List[Dict[str, Any]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    if history:
        for item in history[-6:]:
            role = str(item.get("role") or "user")
            content = str(item.get("content") or "")
            if content:
                messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": prompt})

    if tool_ids or native_tools:
        from backend.mcp.chat_integration import maybe_run_mcp_agent
        from backend.mcp.chat_integration import build_mcp_context_from_user

        mcp_ctx = build_mcp_context_from_user(user or {}, chat_id=None, message_id=None)

        async def _child_executor(**kwargs):
            return await run_isolated_subagent(
                target_agent_id=kwargs["target_agent_id"],
                prompt=kwargs["prompt"],
                parent_profile=kwargs["parent_profile"],
                user=kwargs.get("user"),
                user_id=kwargs.get("user_id"),
                depth=kwargs.get("depth", depth),
                remaining_steps=kwargs.get("remaining_steps", child_limit - 1),
                enable_thinking=enable_thinking,
                emit_event=emit_event,
            )

        subagent_ctx = SubagentRunContext(
            parent_agent_id=child_profile.get("agent_id"),
            parent_profile=child_profile,
            user=user,
            user_id=user_id,
            depth=depth,
            remaining_steps=child_limit - 1,
            executor=_child_executor,
        )
        result = await maybe_run_mcp_agent(
            tool_ids=tool_ids or None,
            user_message=prompt,
            history=[],
            system_prompt=system_prompt or None,
            model_path=model_path,
            mcp_context=mcp_ctx,
            temperature=float(child_profile.get("temperature") or 0.7),
            max_tokens=int(child_profile.get("max_tokens") or 4096),
            enable_thinking=enable_thinking,
            event_callback=emit_event,
            max_iterations=child_limit,
            native_tools=native_tools,
            subagent_ctx=subagent_ctx,
            subagent_config=sub_cfg,
        )
        if result and result.content:
            return result.content.strip()
        return "Subagent finished without a response."

    from backend.app_state import ask_agent

    response = await ask_agent(
        prompt,
        history=[],
        max_tokens=child_profile.get("max_tokens"),
        streaming=False,
        stream_callback=None,
        model_path=model_path,
        custom_prompt_id=None,
        images=None,
        system_prompt=system_prompt or None,
        temperature=child_profile.get("temperature"),
        enable_thinking=enable_thinking,
    )
    return str(response or "").strip() or "Subagent finished without a response."

"""Подключение инструментов плагинов к LangGraph-оркестратору."""

from __future__ import annotations

from typing import Any, Dict, List

from backend.settings.logging import get_logger

log = get_logger(__name__)


def resolve_agent_plugin_ids(agent_profile: Dict[str, Any] | None) -> List[str]:
    if not isinstance(agent_profile, dict):
        return []
    enabled = agent_profile.get("plugins_enabled")
    raw = agent_profile.get("plugin_ids") or []
    if not isinstance(raw, list):
        raw = []
    ids = [str(v).strip() for v in raw if str(v).strip()]
    if enabled is None:
        enabled = bool(ids)
    if not enabled:
        return []
    return ids


async def attach_plugin_tools_to_orchestrator(orchestrator, context: Dict[str, Any]) -> int:
    """Добавляет tools выбранных плагинов в оркестратор (как MCP)."""
    from backend.plugins.tools import get_plugin_tools

    plugin_ids = context.get("__plugin_ids__") or []
    if not isinstance(plugin_ids, list):
        plugin_ids = []
    if not plugin_ids:
        # fallback: из agent_profile в контексте
        profile = context.get("agent_profile") or {}
        plugin_ids = resolve_agent_plugin_ids(profile if isinstance(profile, dict) else {})

    # Плагины, которые backend уже выполнил сам (файл из аттача отправлен в сервис
    # до планирования): инструмент подключать нельзя, иначе аудит уйдёт дважды.
    prerun = context.get("__plugins_prerun__") or []
    if isinstance(prerun, str):
        prerun = [prerun]
    if prerun:
        plugin_ids = [pid for pid in plugin_ids if pid not in set(str(p) for p in prerun)]

    tools = get_plugin_tools(plugin_ids)

    # Оркестратор — синглтон: инструменты прошлого запроса снимаем всегда, иначе
    # они остаются доступны агенту, у которого плагин не подключён.
    dynamic: set = getattr(orchestrator, "_dynamic_plugin_tool_names", set())
    for name in list(dynamic):
        orchestrator.tools = [t for t in orchestrator.tools if getattr(t, "name", None) != name]
        if hasattr(orchestrator, "tools_by_name"):
            orchestrator.tools_by_name.pop(name, None)
        if hasattr(orchestrator, "tool_status"):
            orchestrator.tool_status.pop(name, None)
        dynamic.discard(name)
    orchestrator._dynamic_plugin_tool_names = dynamic

    if not tools:
        if prerun:
            log.info("Orchestrator: плагины %s уже выполнены до планирования, tools не подключаем", prerun)
        return 0

    for tool in tools:
        name = getattr(tool, "name", None) or str(tool)
        orchestrator.tools.append(tool)
        # Без tools_by_name executor не находит инструмент и шаг плана падает
        # с «Инструмент не найден» — файл до сервиса плагина не доходит.
        if hasattr(orchestrator, "tools_by_name"):
            orchestrator.tools_by_name[name] = tool
        if hasattr(orchestrator, "tool_status"):
            orchestrator.tool_status[name] = True
        dynamic.add(name)

    orchestrator._dynamic_plugin_tool_names = dynamic
    log.info("Orchestrator: attached %s plugin tools from plugins=%s", len(tools), plugin_ids)
    return len(tools)

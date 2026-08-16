"""Применение плагинов агента к чату (system append + tool context)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from backend.plugins.orchestrator_bridge import resolve_agent_plugin_ids
from backend.plugins.tools import build_plugins_system_append
from backend.settings.logging import get_logger

logger = get_logger(__name__)


def apply_plugins_to_context(
    *,
    agent_profile: Optional[Dict[str, Any]],
    context: Optional[Dict[str, Any]] = None,
) -> Tuple[str, List[str], Dict[str, Any]]:
    """
    Returns (system_append, plugin_ids, updated_context).
    """
    ids = resolve_agent_plugin_ids(agent_profile if isinstance(agent_profile, dict) else None)
    append = build_plugins_system_append(ids) if ids else ""
    ctx = dict(context or {})
    if ids:
        ctx["__plugin_ids__"] = ids
        if isinstance(agent_profile, dict):
            ctx["agent_profile"] = agent_profile
    return append, ids, ctx

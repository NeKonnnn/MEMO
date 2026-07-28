"""Plan mode: только read/search tools."""

from __future__ import annotations

from typing import FrozenSet

PLAN_ALLOWED_TOOLS: FrozenSet[str] = frozenset(
    {
        "get_workspace",
        "ls",
        "glob",
        "grep",
        "read_file",
        "ask_user",
        "update_plan",
    }
)

MUTATING_TOOLS: FrozenSet[str] = frozenset(
    {
        "write_file",
        "edit_file",
        "apply_patch",
        "delete_file",
        "bash",
        "python",
        "todowrite",
    }
)


def is_tool_allowed(tool_name: str, *, plan_mode: bool) -> bool:
    name = str(tool_name or "").strip()
    if not plan_mode:
        return True
    return name in PLAN_ALLOWED_TOOLS


def plan_mode_block_message(tool_name: str) -> str:
    return (
        f"Инструмент `{tool_name}` недоступен в Plan mode. "
        "Переключитесь в Build (выключите Plan mode), чтобы вносить изменения или запускать bash."
    )

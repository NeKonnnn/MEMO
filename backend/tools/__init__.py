"""
Модуль инструментов: request-scoped context + skills tool.
LangGraph-оркестратор удалён; динамические MCP/plugin tools идут своими путями.
"""

from typing import Any, Dict, List


def get_all_tools() -> List:
    """Совместимость: статический реестр пуст (оркестратор удалён)."""
    return []


def get_tool_categories() -> Dict[str, List]:
    return {}


def get_tools_info() -> Dict[str, Any]:
    return {"total_count": 0, "categories": {}, "tools": []}


__all__ = ["get_all_tools", "get_tool_categories", "get_tools_info"]

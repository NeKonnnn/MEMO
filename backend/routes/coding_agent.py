"""HTTP API для coding agent."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from backend.auth.jwt_handler import get_current_user
from backend.coding_agent.plan_policy import PLAN_ALLOWED_TOOLS, MUTATING_TOOLS
from backend.coding_agent.tools import openai_tool_schemas
from backend.coding_agent.workspace import list_workspace_presets, validate_workspace
from backend.settings.config import get_settings

router = APIRouter(prefix="/api/coding-agent", tags=["coding-agent"])


class ValidateWorkspaceBody(BaseModel):
    path: str = Field(..., min_length=1)


@router.get("/status")
async def coding_agent_status(_user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    cfg = get_settings().coding_agent
    return {
        "enabled": bool(cfg.enabled),
        "max_rounds": cfg.max_rounds,
        "max_tool_calls": cfg.max_tool_calls,
        "bash_timeout_sec": cfg.bash_timeout_sec,
        "allowed_roots": list(cfg.allowed_roots or []),
        "default_workspace": cfg.default_workspace,
        "tools": [t["function"]["name"] for t in openai_tool_schemas()],
        "plan_allowed_tools": sorted(PLAN_ALLOWED_TOOLS),
        "mutating_tools": sorted(MUTATING_TOOLS),
    }


@router.get("/workspaces")
async def coding_agent_workspaces(_user: dict = Depends(get_current_user)) -> Dict[str, Any]:
    """Список workspace-пресетов для UI + проверка существования папок."""
    cfg = get_settings().coding_agent
    presets = list_workspace_presets()
    default_path = str(cfg.default_workspace or "").strip() or None
    if not default_path and presets:
        first_ok = next((p for p in presets if p.get("ok")), None)
        default_path = first_ok["path"] if first_ok else presets[0].get("path")
    return {
        "default_workspace": default_path,
        "presets": presets,
        "path_aliases": dict(cfg.path_aliases or {}),
    }


@router.post("/validate-workspace")
async def coding_agent_validate_workspace(
    body: ValidateWorkspaceBody,
    _user: dict = Depends(get_current_user),
) -> Dict[str, Any]:
    result = validate_workspace(body.path)
    return {
        "ok": result.ok,
        "path": result.path,
        "error": result.error,
    }

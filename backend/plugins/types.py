"""Публичные типы каталога плагинов."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class PluginPublic(BaseModel):
    id: str
    display_name: str
    description: str = ""
    enabled: bool = True
    kind: str = "http"
    category: str = ""
    tags: List[str] = Field(default_factory=list)
    health_path: str = "/health"
    invoke_path: str = "/audit"
    healthy: Optional[bool] = None
    health_detail: Optional[Dict[str, Any]] = None


class PluginHealthResult(BaseModel):
    id: str
    ok: bool
    status_code: Optional[int] = None
    detail: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None

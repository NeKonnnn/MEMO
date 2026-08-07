"""Pydantic-модели пользовательских проектов."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

ProjectMemory = Literal["default", "project-only"]
ProjectIconType = Literal["icon", "emoji"]


class ProjectCreate(BaseModel):
    id: Optional[str] = Field(None, max_length=64, description="ID проекта (если задан клиентом)")
    name: str = Field(..., min_length=1, max_length=255)
    instructions: str = Field(default="", max_length=10000)
    memory: ProjectMemory = "default"
    icon: Optional[str] = Field(None, max_length=64)
    icon_type: Optional[ProjectIconType] = Field(None, alias="iconType")
    icon_color: Optional[str] = Field(None, max_length=32, alias="iconColor")

    model_config = {"populate_by_name": True}


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    instructions: Optional[str] = Field(None, max_length=10000)
    memory: Optional[ProjectMemory] = None
    icon: Optional[str] = Field(None, max_length=64)
    icon_type: Optional[ProjectIconType] = Field(None, alias="iconType")
    icon_color: Optional[str] = Field(None, max_length=32, alias="iconColor")

    model_config = {"populate_by_name": True}

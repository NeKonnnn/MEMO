"""CRUD метаданных пользовательских проектов (инструкции, иконка, память)."""

from __future__ import annotations

from typing import Annotated, List

from fastapi import APIRouter, Depends, HTTPException

from backend.auth.jwt_handler import get_current_user
from backend.database.init_db import get_project_repository
from backend.database.postgresql.project_models import ProjectCreate, ProjectUpdate
from backend.settings.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
async def list_projects(current_user: Annotated[dict, Depends(get_current_user)]):
    repo = get_project_repository()
    user_id = str(current_user.get("user_id") or "").strip()
    projects: List[dict] = await repo.list_by_user(user_id)
    return {"projects": projects, "count": len(projects)}


@router.post("", status_code=201)
async def create_project(
    body: ProjectCreate,
    current_user: Annotated[dict, Depends(get_current_user)],
):
    repo = get_project_repository()
    user_id = str(current_user.get("user_id") or "").strip()
    created = await repo.create(user_id, body)
    if not created:
        raise HTTPException(status_code=500, detail="Не удалось создать проект")
    logger.info("[projects] создан проект id=%s user=%s", created["id"], user_id)
    return {"success": True, "project": created}


@router.put("/{project_id}")
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    current_user: Annotated[dict, Depends(get_current_user)],
):
    repo = get_project_repository()
    user_id = str(current_user.get("user_id") or "").strip()
    existing = await repo.get_by_id(user_id, project_id)
    if not existing:
        created = await repo.create(
            user_id,
            ProjectCreate(
                id=project_id,
                name=body.name or "Проект",
                instructions=body.instructions or "",
                memory=body.memory or "default",
                icon=body.icon,
                icon_type=body.icon_type,
                icon_color=body.icon_color,
            ),
        )
        if not created:
            raise HTTPException(status_code=404, detail="Проект не найден")
        return {"success": True, "project": created}
    updated = await repo.update(user_id, project_id, body)
    if not updated:
        raise HTTPException(status_code=404, detail="Проект не найден")
    logger.info("[projects] обновлён проект id=%s user=%s", project_id, user_id)
    return {"success": True, "project": updated}


@router.get("/{project_id}")
async def get_project(
    project_id: str,
    current_user: Annotated[dict, Depends(get_current_user)],
):
    repo = get_project_repository()
    user_id = str(current_user.get("user_id") or "").strip()
    project = await repo.get_by_id(user_id, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Проект не найден")
    return {"project": project}

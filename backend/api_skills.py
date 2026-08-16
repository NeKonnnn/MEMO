"""API endpoints для Skills (аналог Open WebUI /api/v1/skills)."""

import asyncio
from typing import Annotated, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.auth.jwt_handler import get_current_user
from backend.database.init_db import get_skill_repository
from backend.database.postgresql.skill_models import (
    SkillCreate,
    SkillFileCreate,
    SkillFileOut,
    SkillFilters,
    SkillListItem,
    SkillOut,
    SkillRatingRequest,
    SkillShareEntry,
    SkillShareRequest,
    SkillSharesResponse,
    SkillUpdate,
)
from backend.settings.logging import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/skills", tags=["skills"])

_full_name_cache: Dict[str, Optional[str]] = {}


def _is_admin(user: dict) -> bool:
    return bool(user.get("is_admin"))


async def _resolve_full_names(user_ids: List[str]) -> Dict[str, Optional[str]]:
    result: Dict[str, Optional[str]] = {}
    to_lookup: List[str] = []
    seen: set = set()
    for raw in user_ids:
        uid = (raw or "").strip()
        if not uid:
            continue
        key = uid.lower()
        if key in seen:
            continue
        seen.add(key)
        if key in _full_name_cache:
            result[uid] = _full_name_cache[key]
        else:
            to_lookup.append(uid)
    if not to_lookup:
        return result
    try:
        from backend.auth.ldap_auth import fetch_ldap_user_profile, is_ldap_enabled
    except Exception:
        for uid in to_lookup:
            result[uid] = None
        return result
    if not is_ldap_enabled():
        for uid in to_lookup:
            result[uid] = None
        return result

    def _bulk() -> Dict[str, Optional[str]]:
        out: Dict[str, Optional[str]] = {}
        for uid in to_lookup:
            name = None
            try:
                profile = fetch_ldap_user_profile(uid)
                if profile:
                    name = profile.get("full_name") or None
            except Exception:
                name = None
            out[uid] = name
        return out

    try:
        looked = await asyncio.to_thread(_bulk)
    except Exception:
        looked = {uid: None for uid in to_lookup}
    for uid, name in looked.items():
        _full_name_cache[uid.lower()] = name
        result[uid] = name
    return result


class SkillsListResponse(BaseModel):
    items: List[SkillListItem] = []
    total: int = 0
    page: int = 1
    pages: int = 0


@router.get("/", response_model=List[SkillListItem])
async def get_skills(current_user: Annotated[dict, Depends(get_current_user)]):
    """Все доступные skills (без content)."""
    try:
        repo = get_skill_repository()
        items, _ = await repo.list_skills(
            current_user["user_id"],
            SkillFilters(limit=100, offset=0),
            is_admin=_is_admin(current_user),
        )
        return items
    except Exception as e:
        logger.exception("Ошибка get_skills")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/list", response_model=SkillsListResponse)
async def get_skill_list(
    current_user: Annotated[dict, Depends(get_current_user)],
    query: Annotated[Optional[str], Query()] = None,
    view_option: Annotated[Optional[str], Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
):
    """Пагинированный список skills."""
    try:
        repo = get_skill_repository()
        filters = SkillFilters(
            search_query=query,
            view_option=view_option,
            limit=limit,
            offset=(page - 1) * limit,
        )
        items, total = await repo.list_skills(
            current_user["user_id"], filters, is_admin=_is_admin(current_user)
        )
        pages = (total + limit - 1) // limit if total else 0
        return SkillsListResponse(items=items, total=total, page=page, pages=pages)
    except Exception as e:
        logger.exception("Ошибка get_skill_list")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/export", response_model=List[SkillOut])
async def export_skills(current_user: Annotated[dict, Depends(get_current_user)]):
    """Export доступных skills с content."""
    try:
        repo = get_skill_repository()
        return await repo.get_accessible_skills(
            current_user["user_id"], is_admin=_is_admin(current_user)
        )
    except Exception as e:
        logger.exception("Ошибка export_skills")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/create", response_model=SkillOut, status_code=201)
@router.post("/", response_model=SkillOut, status_code=201)
async def create_skill(
    skill_data: SkillCreate, current_user: Annotated[dict, Depends(get_current_user)]
):
    """Создание skill."""
    try:
        repo = get_skill_repository()
        skill = await repo.create_skill(
            skill_data,
            author_id=current_user["user_id"],
            author_name=current_user.get("username") or current_user.get("full_name") or "Anonymous",
        )
        if not skill:
            raise HTTPException(status_code=400, detail="Не удалось создать skill (slug/name заняты?)")
        return skill
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка create_skill")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/my/bookmarks", response_model=SkillsListResponse)
async def get_my_bookmarks(
    current_user: Annotated[dict, Depends(get_current_user)],
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    """Закладки текущего пользователя (пагинация)."""
    try:
        repo = get_skill_repository()
        bookmark_ids, total = await repo.get_user_bookmarks(
            current_user["user_id"], limit=limit, offset=(page - 1) * limit
        )
        if not bookmark_ids:
            return SkillsListResponse(items=[], total=0, page=page, pages=0)
        items: List[SkillListItem] = []
        admin = _is_admin(current_user)
        for sid in bookmark_ids:
            skill = await repo.get_skill_by_id(sid, current_user["user_id"], is_admin=admin)
            if skill:
                items.append(SkillListItem(**skill.model_dump(exclude={"content"})))
        pages = (total + limit - 1) // limit if total else 0
        return SkillsListResponse(items=items, total=total, page=page, pages=pages)
    except Exception as e:
        logger.exception("Ошибка get_my_bookmarks skills")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/id/{skill_id}", response_model=SkillOut)
@router.get("/{skill_id}", response_model=SkillOut)
async def get_skill(skill_id: str, current_user: Annotated[dict, Depends(get_current_user)]):
    """Получение skill по id или slug."""
    try:
        repo = get_skill_repository()
        admin = _is_admin(current_user)
        skill = None
        if skill_id.isdigit():
            skill = await repo.get_skill_by_id(int(skill_id), current_user["user_id"], is_admin=admin)
        if not skill:
            skill = await repo.get_skill_by_slug(skill_id, current_user["user_id"], is_admin=admin)
        if not skill:
            raise HTTPException(status_code=404, detail="Skill не найден")
        await repo.increment_views(skill.id)
        return skill
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка get_skill")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/{skill_id}/rate", response_model=dict)
async def rate_skill(
    skill_id: int,
    rating_request: SkillRatingRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
):
    """Оценка skill пользователем."""
    try:
        repo = get_skill_repository()
        if not await repo.can_read(skill_id, current_user["user_id"], is_admin=_is_admin(current_user)):
            raise HTTPException(status_code=404, detail="Skill не найден")
        success = await repo.rate_skill(
            skill_id=skill_id, user_id=current_user["user_id"], rating=rating_request.rating
        )
        if success:
            return {"success": True, "message": "Оценка сохранена"}
        raise HTTPException(status_code=404, detail="Skill не найден")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка rate_skill")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/{skill_id}/view", response_model=dict)
async def view_skill(skill_id: int, current_user: Annotated[dict, Depends(get_current_user)]):
    """Увеличить счётчик просмотров skill."""
    try:
        repo = get_skill_repository()
        if not await repo.can_read(skill_id, current_user["user_id"], is_admin=_is_admin(current_user)):
            raise HTTPException(status_code=404, detail="Skill не найден")
        success = await repo.increment_views(skill_id)
        if success:
            return {"success": True, "message": "Просмотр учтён"}
        raise HTTPException(status_code=404, detail="Skill не найден")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка view_skill")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/{skill_id}/use", response_model=dict)
async def use_skill(skill_id: int, current_user: Annotated[dict, Depends(get_current_user)]):
    """Увеличить счётчик использований skill."""
    try:
        repo = get_skill_repository()
        if not await repo.can_read(skill_id, current_user["user_id"], is_admin=_is_admin(current_user)):
            raise HTTPException(status_code=404, detail="Skill не найден")
        success = await repo.increment_usage(skill_id)
        if success:
            return {"success": True, "message": "Использование учтено"}
        raise HTTPException(status_code=404, detail="Skill не найден")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка use_skill")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/{skill_id}/bookmark", response_model=dict)
async def add_bookmark(skill_id: int, current_user: Annotated[dict, Depends(get_current_user)]):
    """Добавить skill в закладки."""
    try:
        repo = get_skill_repository()
        if not await repo.can_read(skill_id, current_user["user_id"], is_admin=_is_admin(current_user)):
            raise HTTPException(status_code=404, detail="Skill не найден")
        success = await repo.add_bookmark(skill_id, current_user["user_id"])
        if success:
            return {"success": True, "message": "Добавлено в закладки"}
        raise HTTPException(status_code=404, detail="Skill не найден")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка add_bookmark skill")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete("/{skill_id}/bookmark", response_model=dict)
async def remove_bookmark(skill_id: int, current_user: Annotated[dict, Depends(get_current_user)]):
    """Удалить skill из закладок."""
    try:
        repo = get_skill_repository()
        success = await repo.remove_bookmark(skill_id, current_user["user_id"])
        if success:
            return {"success": True, "message": "Удалено из закладок"}
        raise HTTPException(status_code=404, detail="Skill не найден")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка remove_bookmark skill")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/id/{skill_id}/update", response_model=SkillOut)
@router.put("/{skill_id}", response_model=SkillOut)
async def update_skill(
    skill_id: int,
    skill_data: SkillUpdate,
    current_user: Annotated[dict, Depends(get_current_user)],
):
    """Обновление skill."""
    try:
        repo = get_skill_repository()
        skill = await repo.update_skill(
            skill_id, skill_data, current_user["user_id"], is_admin=_is_admin(current_user)
        )
        if not skill:
            raise HTTPException(status_code=403, detail="Нет прав или skill не найден")
        return skill
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        logger.exception("Ошибка update_skill")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/id/{skill_id}/toggle", response_model=SkillOut)
@router.post("/{skill_id}/toggle", response_model=SkillOut)
async def toggle_skill(skill_id: int, current_user: Annotated[dict, Depends(get_current_user)]):
    """Переключить is_active."""
    try:
        repo = get_skill_repository()
        skill = await repo.toggle_skill(
            skill_id, current_user["user_id"], is_admin=_is_admin(current_user)
        )
        if not skill:
            raise HTTPException(status_code=403, detail="Нет прав или skill не найден")
        return skill
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка toggle_skill")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete("/id/{skill_id}/delete", response_model=dict)
@router.delete("/{skill_id}", response_model=dict)
async def delete_skill(skill_id: int, current_user: Annotated[dict, Depends(get_current_user)]):
    """Удаление skill (только owner/admin)."""
    try:
        repo = get_skill_repository()
        ok = await repo.delete_skill(
            skill_id, current_user["user_id"], is_admin=_is_admin(current_user)
        )
        if not ok:
            raise HTTPException(status_code=403, detail="Нет прав или skill не найден")
        return {"success": True, "message": "Skill удалён"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка delete_skill")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/{skill_id}/share", response_model=dict)
async def share_skill(
    skill_id: int,
    payload: SkillShareRequest,
    current_user: Annotated[dict, Depends(get_current_user)],
):
    """Поделиться skill."""
    try:
        repo = get_skill_repository()
        existing = await repo.get_skill_by_id(
            skill_id, current_user["user_id"], is_admin=_is_admin(current_user)
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Skill не найден")
        added, skipped = await repo.share_skill(
            skill_id=skill_id,
            owner_id=current_user["user_id"],
            usernames=payload.usernames,
            permission=payload.permission,
        )
        if not added and skipped:
            raise HTTPException(status_code=403, detail="Не удалось поделиться skill")
        return {
            "success": True,
            "shared_with": added,
            "skipped": skipped,
            "message": f"Skill доступен для: {', '.join(added)}" if added else "Никого не добавлено",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка share_skill")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/{skill_id}/shares", response_model=SkillSharesResponse)
async def list_skill_shares(skill_id: int, current_user: Annotated[dict, Depends(get_current_user)]):
    """Список доступа к skill."""
    try:
        repo = get_skill_repository()
        existing = await repo.get_skill_by_id(
            skill_id, current_user["user_id"], is_admin=_is_admin(current_user)
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Skill не найден")
        author = (existing.author_id or "").strip().lower()
        me = (current_user["user_id"] or "").strip().lower()
        if author != me and not _is_admin(current_user):
            raise HTTPException(status_code=403, detail="Только автор может просматривать шаринги")
        raw_shares = await repo.list_skill_shares(skill_id, existing.author_id)
        owner_id = existing.author_id or current_user["user_id"]
        name_map = await _resolve_full_names([owner_id, *[s.shared_with_user_id for s in raw_shares]])
        owner_name = name_map.get(owner_id)
        if not owner_name and author == me:
            owner_name = current_user.get("full_name") or current_user.get("name")
        return SkillSharesResponse(
            owner=SkillShareEntry(user_id=owner_id, full_name=owner_name, permission="owner"),
            shares=[
                SkillShareEntry(
                    user_id=s.shared_with_user_id,
                    full_name=name_map.get(s.shared_with_user_id),
                    permission="editor" if (s.permission or "").lower() == "editor" else "viewer",
                )
                for s in raw_shares
            ],
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка list_skill_shares")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete("/{skill_id}/share/{username}", response_model=dict)
async def unshare_skill(
    skill_id: int, username: str, current_user: Annotated[dict, Depends(get_current_user)]
):
    """Снять доступ."""
    try:
        repo = get_skill_repository()
        ok = await repo.unshare_skill(skill_id, current_user["user_id"], username)
        if ok:
            return {"success": True, "message": f"Доступ для {username} снят"}
        raise HTTPException(status_code=403, detail="Не удалось снять доступ")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Ошибка unshare_skill")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/{skill_id}/files", response_model=List[SkillFileOut])
async def list_skill_files(skill_id: int, current_user: Annotated[dict, Depends(get_current_user)]):
    repo = get_skill_repository()
    skill = await repo.get_skill_by_id(skill_id, current_user["user_id"], is_admin=_is_admin(current_user))
    if not skill:
        raise HTTPException(status_code=404, detail="Skill не найден")
    return await repo.list_skill_files(skill_id)


@router.post("/{skill_id}/files", response_model=SkillFileOut, status_code=201)
async def upsert_skill_file(
    skill_id: int,
    payload: SkillFileCreate,
    current_user: Annotated[dict, Depends(get_current_user)],
):
    repo = get_skill_repository()
    if not await repo.can_write(skill_id, current_user["user_id"], is_admin=_is_admin(current_user)):
        raise HTTPException(status_code=403, detail="Нет прав")
    if payload.content is None:
        raise HTTPException(status_code=400, detail="Укажите content")
    file_row = await repo.upsert_skill_file_text(
        skill_id,
        payload.relative_path,
        payload.content,
        mime_type=payload.mime_type or "text/plain",
        is_executable=payload.is_executable,
    )
    if not file_row:
        raise HTTPException(status_code=400, detail="Не удалось сохранить файл (SKILL.md запрещён как relative_path)")
    return file_row


@router.get("/{skill_id}/files/content")
async def get_skill_file_content(
    skill_id: int,
    path: Annotated[str, Query()],
    current_user: Annotated[dict, Depends(get_current_user)],
):
    repo = get_skill_repository()
    skill = await repo.get_skill_by_id(skill_id, current_user["user_id"], is_admin=_is_admin(current_user))
    if not skill:
        raise HTTPException(status_code=404, detail="Skill не найден")
    text = await repo.get_skill_file_content(skill_id, path)
    if text is None:
        raise HTTPException(status_code=404, detail="Файл не найден")
    return {"relative_path": path, "content": text}


@router.delete("/{skill_id}/files/{file_id}", response_model=dict)
async def delete_skill_file(
    skill_id: int, file_id: int, current_user: Annotated[dict, Depends(get_current_user)]
):
    repo = get_skill_repository()
    if not await repo.can_write(skill_id, current_user["user_id"], is_admin=_is_admin(current_user)):
        raise HTTPException(status_code=403, detail="Нет прав")
    ok = await repo.delete_skill_file(skill_id, file_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Файл не найден")
    return {"success": True}

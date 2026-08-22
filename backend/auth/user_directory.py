"""Резолв ФИО и поиск пользователей в LDAP (общий для agents/skills/share)."""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

from backend.settings.logging import get_logger

logger = get_logger(__name__)

# Кэш ФИО по gpbu (логин один и тот же для LDAP и SSO)
_full_name_cache: Dict[str, Optional[str]] = {}


async def resolve_full_names(user_ids: List[str]) -> Dict[str, Optional[str]]:
    """ФИО по списку gpbu из LDAP (service bind). Логин одинаков для LDAP и SSO."""
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
    except Exception:  # pragma: no cover
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
            name: Optional[str] = None
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
        logger.exception("Ошибка резолва ФИО по gpbu")
        looked = {uid: None for uid in to_lookup}

    for uid, name in looked.items():
        _full_name_cache[uid.lower()] = name
        result[uid] = name
    return result


async def enrich_items_author_full_names(items: List[Any]) -> None:
    """Проставить author_full_name у объектов с author_id / author_name."""
    if not items:
        return
    ids: List[str] = []
    for item in items:
        aid = getattr(item, "author_id", None) or getattr(item, "author_name", None)
        if aid:
            ids.append(str(aid))
    name_map = await resolve_full_names(ids)
    if not name_map:
        for item in items:
            if hasattr(item, "author_full_name"):
                try:
                    item.author_full_name = None
                except Exception:
                    pass
        return

    lower_map = {k.lower(): v for k, v in name_map.items()}
    for item in items:
        aid = (getattr(item, "author_id", None) or getattr(item, "author_name", None) or "")
        key = str(aid).strip()
        name = name_map.get(key)
        if name is None and key:
            name = lower_map.get(key.lower())
        try:
            item.author_full_name = name
        except Exception:
            pass


async def search_directory_users(query: str, limit: int = 10) -> List[Dict[str, Any]]:
    """Поиск пользователей по gpbu / ФИО / email через LDAP."""
    q = (query or "").strip()
    if len(q) < 2:
        return []
    limit = max(1, min(int(limit or 10), 20))

    try:
        from backend.auth.ldap_auth import is_ldap_enabled, search_ldap_users
    except Exception:
        return []

    if not is_ldap_enabled():
        return []

    try:
        return await asyncio.to_thread(search_ldap_users, q, limit)
    except Exception:
        logger.exception("Ошибка LDAP search users q=%s", q)
        return []

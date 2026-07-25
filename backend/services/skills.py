"""Skills activation — LibreChat-like (manual / always-apply / model catalog)."""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from backend.database.postgresql.skill_models import SkillFilters
from backend.settings.logging import get_logger

logger = get_logger(__name__)

SKILL_MENTION_RE = re.compile(r"<\$([^|>]+)\|?[^>]*>")
STRIP_MENTION_RE = re.compile(r"<\$[^>]+>")

MAX_MANUAL_SKILLS = 10
MAX_ALWAYS_APPLY = 20
MAX_CATALOG = 100


def extract_skill_ids_from_text(text: str) -> Set[str]:
    if not text:
        return set()
    return {m.group(1).strip() for m in SKILL_MENTION_RE.finditer(text) if m.group(1).strip()}


def extract_skill_ids_from_messages(messages: Sequence[Any]) -> Set[str]:
    ids: Set[str] = set()
    for message in messages or []:
        if isinstance(message, dict):
            content = message.get("content")
        else:
            content = message
        if isinstance(content, str):
            ids |= extract_skill_ids_from_text(content)
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    ids |= extract_skill_ids_from_text(str(part.get("text") or ""))
    return ids


def strip_skill_mentions(text: str) -> str:
    if not text:
        return text
    return STRIP_MENTION_RE.sub("", text).strip()


def normalize_skill_id_list(raw: Any) -> List[str]:
    if not raw:
        return []
    if isinstance(raw, str):
        raw = [raw]
    out: List[str] = []
    seen: Set[str] = set()
    for item in raw:
        key = str(item or "").strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def build_full_skill_block(name: str, content: str, *, trigger: str = "manual") -> str:
    return f'<skill name="{name}" trigger="{trigger}">\n{content or ""}\n</skill>'


def build_available_skills_manifest(skills: Sequence[Any]) -> str:
    parts: List[str] = []
    for s in skills:
        if getattr(s, "disable_model_invocation", False):
            continue
        sid = getattr(s, "slug", None) or getattr(s, "id", "")
        name = getattr(s, "name", "") or ""
        desc = getattr(s, "description", None) or ""
        parts.append(
            f"<skill>\n<id>{sid}</id>\n<name>{name}</name>\n<description>{desc}</description>\n</skill>"
        )
    if not parts:
        return ""
    return (
        "<available_skills>\n"
        + "\n".join(parts)
        + "\n</available_skills>\n"
        "Use the view_skill tool with a skill id from this manifest when you need the full instructions."
    )


def append_to_system_prompt(system_prompt: Optional[str], block: str) -> str:
    block = (block or "").strip()
    if not block:
        return system_prompt or ""
    base = (system_prompt or "").rstrip()
    if not base:
        return block
    return f"{base}\n\n{block}"


def collect_allowed_tools(skills: Sequence[Any]) -> List[str]:
    out: List[str] = []
    seen: Set[str] = set()
    for s in skills:
        for t in getattr(s, "allowed_tools", None) or []:
            key = str(t).strip()
            if key and key not in seen:
                seen.add(key)
                out.append(key)
    return out


def resolve_agent_skill_scope(agent_profile: Optional[Dict[str, Any]]) -> Tuple[bool, List[str]]:
    """
    Returns (skills_enabled, allowlist_slugs).
    LibreChat: skills_enabled gate + optional skills[] allowlist.
    Backward-compat: skill_ids alone implies enabled.
    """
    if not isinstance(agent_profile, dict):
        return False, []
    raw_ids = normalize_skill_id_list(agent_profile.get("skill_ids") or agent_profile.get("skills"))
    enabled = agent_profile.get("skills_enabled")
    if enabled is None:
        # Legacy: any skill_ids means enabled
        enabled = bool(raw_ids)
    return bool(enabled), raw_ids


async def resolve_and_build_skill_injection(
    *,
    user_skill_ids: Iterable[str],
    agent_skill_ids: Iterable[str],
    user_id: Optional[str],
    is_admin: bool = False,
    skills_enabled: bool = True,
    eager_agent_fallback: bool = True,
) -> Tuple[str, List[str], List[str], Dict[str, List[str]]]:
    """
    Returns:
      system_append,
      lazy_skill_ids (catalog / view_skill),
      allowed_tools_extra,
      primed_meta {manual: [...], always_apply: [...]}
    """
    if not user_id:
        return "", [], [], {"manual": [], "always_apply": []}

    user_ids = set(normalize_skill_id_list(list(user_skill_ids))[:MAX_MANUAL_SKILLS])
    agent_ids = set(normalize_skill_id_list(list(agent_skill_ids))) if skills_enabled else set()

    try:
        from backend.database.init_db import get_skill_repository

        repo = get_skill_repository()
    except Exception:
        logger.exception("skill repository unavailable")
        return "", [], [], {"manual": [], "always_apply": []}

    always_skills = await repo.list_always_apply_skills(user_id, is_admin=is_admin, limit=MAX_ALWAYS_APPLY)
    # If agent allowlist is non-empty, restrict always-apply to intersection
    if agent_ids:
        always_skills = [
            s
            for s in always_skills
            if s.slug in agent_ids or str(s.id) in agent_ids
        ]
    elif not skills_enabled and not user_ids:
        always_skills = []

    always_ids = {s.slug for s in always_skills}
    all_ids = list(user_ids | agent_ids | always_ids)
    skills = await repo.resolve_skills_for_user(all_ids, user_id, is_admin=is_admin) if all_ids else []
    # Merge always_skills that might not be in resolve list yet
    by_slug = {s.slug: s for s in skills}
    for s in always_skills:
        by_slug.setdefault(s.slug, s)
    skills = list(by_slug.values())

    if not skills and not agent_ids:
        # Still may need catalog from agent allowlist empty = all accessible
        pass

    blocks: List[str] = []
    lazy_ids: List[str] = []
    primed_manual: List[str] = []
    primed_always: List[str] = []
    primed_for_tools: List[Any] = []
    catalog_skills = []

    for skill in skills:
        key_ids = {str(skill.id), skill.slug}
        is_manual = bool(key_ids & user_ids) and getattr(skill, "user_invocable", True)
        is_always = skill.slug in always_ids or bool(getattr(skill, "always_apply", False) and (not agent_ids or skill.slug in agent_ids or str(skill.id) in agent_ids))
        is_agent = bool(key_ids & agent_ids) and skills_enabled

        if is_manual:
            blocks.append(build_full_skill_block(skill.name, skill.content, trigger="manual"))
            primed_manual.append(skill.slug)
            primed_for_tools.append(skill)
        elif is_always:
            blocks.append(build_full_skill_block(skill.name, skill.content, trigger="always-apply"))
            primed_always.append(skill.slug)
            primed_for_tools.append(skill)
        elif is_agent:
            if not getattr(skill, "disable_model_invocation", False):
                catalog_skills.append(skill)
                lazy_ids.append(skill.slug)
                if eager_agent_fallback:
                    blocks.append(build_full_skill_block(skill.name, skill.content, trigger="model"))
                    primed_for_tools.append(skill)

    # Catalog from agent scope when allowlist empty but enabled: top accessible
    if skills_enabled and not agent_ids and not catalog_skills:
        accessible, _ = await repo.list_skills(
            user_id,
            SkillFilters(limit=MAX_CATALOG, offset=0),
            is_admin=is_admin,
        )
        for it in accessible:
            if it.disable_model_invocation or not it.is_active:
                continue
            full = await repo.get_skill_by_id(it.id, user_id=user_id, is_admin=is_admin)
            if full:
                catalog_skills.append(full)
                lazy_ids.append(full.slug)

    if catalog_skills:
        man = build_available_skills_manifest(catalog_skills[:MAX_CATALOG])
        if man:
            blocks.insert(0, man)

    allowed_extra = collect_allowed_tools(primed_for_tools)
    return (
        "\n\n".join(blocks),
        lazy_ids,
        allowed_extra,
        {"manual": primed_manual, "always_apply": primed_always},
    )


async def apply_skills_to_chat(
    *,
    system_prompt: Optional[str],
    user_message: str,
    data: Dict[str, Any],
    agent_profile: Optional[Dict[str, Any]],
    current_user: Optional[Dict[str, Any]],
    history: Optional[Sequence[Any]] = None,
) -> Tuple[Optional[str], str, List[str], List[str], Dict[str, List[str]]]:
    """
    Returns (system_prompt, stripped_user_message, lazy_ids, allowed_tools_extra, primed_meta).
    """
    user = current_user or {}
    user_id = user.get("user_id")
    is_admin = bool(user.get("is_admin"))

    payload_ids = normalize_skill_id_list(data.get("skill_ids") or data.get("manual_skills"))
    from_msg = extract_skill_ids_from_text(user_message or "")
    from_hist = extract_skill_ids_from_messages(history or [])
    user_skill_ids = set(payload_ids) | from_msg | from_hist

    skills_enabled, agent_skill_ids = resolve_agent_skill_scope(agent_profile)

    block, lazy_ids, allowed_extra, primed = await resolve_and_build_skill_injection(
        user_skill_ids=user_skill_ids,
        agent_skill_ids=agent_skill_ids,
        user_id=user_id,
        is_admin=is_admin,
        skills_enabled=skills_enabled,
        eager_agent_fallback=True,
    )
    new_prompt = append_to_system_prompt(system_prompt, block) if block else system_prompt
    stripped = strip_skill_mentions(user_message or "")
    return new_prompt, stripped, lazy_ids, allowed_extra, primed

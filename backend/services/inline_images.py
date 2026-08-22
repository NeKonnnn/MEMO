"""Подтягивание inline-картинок из истории чата для follow-up без повторного attach."""

from __future__ import annotations

import base64
from typing import Any, Dict, List, Optional, Sequence

from backend.settings.logging import get_logger

logger = get_logger(__name__)

# Сколько картинок из прошлых сообщений тащим в текущий ход (плюс текущие attach).
MAX_HISTORY_INLINE_IMAGES = 8


def image_refs_from_metadata(metadata: Optional[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Ссылки на image-вложения из metadata сообщения (без байтов)."""
    meta = metadata if isinstance(metadata, dict) else {}
    refs: List[Dict[str, str]] = []
    for att in meta.get("inline_attachments") or []:
        if not isinstance(att, dict):
            continue
        if (att.get("contentType") or att.get("content_type")) != "image":
            continue
        mo = str(att.get("minio_object") or "").strip()
        mb = str(att.get("minio_bucket") or "").strip()
        if not mo or not mb:
            continue
        refs.append(
            {
                "minio_object": mo,
                "minio_bucket": mb,
                "name": str(att.get("name") or "image").strip() or "image",
            }
        )
    return refs


def inline_attachment_as_data_url(bucket: str, object_name: str) -> Optional[str]:
    """Читает файл из pod INLINE_ATTACH_DIR или MinIO → data URL для vision."""
    try:
        from backend.routes.documents import read_inline_attachment_bytes
    except Exception:
        logger.exception("inline image: не удалось импортировать read_inline_attachment_bytes")
        return None
    loaded = read_inline_attachment_bytes(bucket, object_name)
    if not loaded:
        return None
    data, mime = loaded
    if not data:
        return None
    b64 = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{b64}"


def merge_inline_images_from_history(
    history: Optional[Sequence[Dict[str, Any]]],
    current_images: Optional[Sequence[str]] = None,
    *,
    max_history_images: int = MAX_HISTORY_INLINE_IMAGES,
) -> List[str]:
    """Картинки из прошлых user-сообщений + текущий turn (data URL / path).

    Порядок: сначала история (старые → новые), затем текущие attach.
    """
    out: List[str] = []
    seen_keys: set[str] = set()

    for entry in history or []:
        if len(out) >= max_history_images:
            break
        if (entry.get("role") or "").strip().lower() != "user":
            continue
        refs = entry.get("image_refs")
        if not isinstance(refs, list):
            refs = []
        for ref in refs:
            if len(out) >= max_history_images:
                break
            if not isinstance(ref, dict):
                continue
            mo = str(ref.get("minio_object") or "").strip()
            mb = str(ref.get("minio_bucket") or "").strip()
            if not mo or not mb:
                continue
            key = f"{mb}/{mo}"
            if key in seen_keys:
                continue
            url = inline_attachment_as_data_url(mb, mo)
            if not url:
                logger.warning("inline image: не прочитан bucket=%s object=%s", mb, mo)
                continue
            seen_keys.add(key)
            out.append(url)

    for img in current_images or []:
        s = str(img or "").strip()
        if not s:
            continue
        # data URL текущего хода — не сравниваем с object-key; просто добавляем
        if s in seen_keys:
            continue
        seen_keys.add(s[:120] if s.startswith("data:") else s)
        out.append(s)

    if out:
        logger.debug(
            "inline images: history+current → %s шт. (history_cap=%s)",
            len(out),
            max_history_images,
        )
    return out

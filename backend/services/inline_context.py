"""Подготовка inline-контекста вложений перед отправкой в LLM.

Frontend склеивает вложения в ```inline_context``` как ```[имя]\\n<текст>```,
разделённые пустой строкой, и backend вставляет это в сообщение пользователя.
Содержимое вложения идёт в промпт целиком — лимита символов здесь нет.

Единственное исключение: файл, который читает сам плагин (cash-flow берёт
.xlsx байтами из ```INLINE_ATTACH_DIR```/MinIO и отправляет в свой сервис).
Его дамп ячеек в промпте бесполезен и переполняет контекст шлюза (HTTP 400),
поэтому вместо текста подставляется короткая заметка.
"""

from __future__ import annotations

from typing import Any, List, Optional, Sequence, Tuple

from backend.settings.logging import get_logger

logger = get_logger(__name__)


def attachment_names(attachments: Optional[Sequence[Any]]) -> List[str]:
    """Имена вложений сообщения в порядке, в котором их склеил frontend."""
    names: List[str] = []
    for item in attachments or []:
        if isinstance(item, dict):
            name = str(item.get("name") or "").strip()
        else:
            name = str(item or "").strip()
        if name:
            names.append(name)
    return names


def _marker_positions(inline_context: str, names: Sequence[str]) -> List[Tuple[str, int]]:
    """Позиции маркеров ```[имя]``` — ищем последовательно, как их писал frontend."""
    found: List[Tuple[str, int]] = []
    cursor = 0
    for name in names:
        idx = inline_context.find(f"[{name}]", cursor)
        if idx < 0:
            continue
        found.append((name, idx))
        cursor = idx + len(name) + 2
    return found


def strip_plugin_owned_attachments(
    inline_context: str,
    *,
    plugin_ids: Optional[Sequence[str]],
    attachments: Optional[Sequence[Any]],
    note_override: Optional[str] = None,
) -> Tuple[str, List[str]]:
    """Вырезает из inline-контекста файлы, которые уходят в сервис плагина.

    ``note_override`` — заметка вместо стандартной («вызови инструмент»): в прямом
    режиме инструментов нет, там плагин уже выполнен самим backend.

    Returns (новый inline_context, имена вырезанных файлов).
    """
    text = inline_context or ""
    if not text.strip():
        return text, []
    ids = [str(x).strip() for x in (plugin_ids or []) if str(x).strip()]
    if not ids:
        return text, []

    from backend.plugins.tools import plugin_attachment_prompt_note, plugin_owned_attachment_names

    names = attachment_names(attachments)
    owned = plugin_owned_attachment_names(ids, names)
    if not owned:
        return text, []

    note = (note_override or "").strip() or plugin_attachment_prompt_note(ids, owned)
    markers = _marker_positions(text, names)
    if not markers:
        # Разметку не опознали (другой источник inline_context) — режем целиком,
        # иначе дамп модели снова переполнит контекст.
        logger.info("[inline_context] маркеры вложений не найдены, содержимое заменено заметкой")
        return note, owned

    owned_set = set(owned)
    keep_parts: List[str] = []
    for position, (name, start) in enumerate(markers):
        end = markers[position + 1][1] if position + 1 < len(markers) else len(text)
        block = text[start:end].strip()
        if name in owned_set:
            continue
        if block:
            keep_parts.append(block)
    if note:
        keep_parts.append(note)
    return "\n\n".join(keep_parts).strip(), owned


def prepare_inline_context(
    inline_context: str,
    *,
    plugin_ids: Optional[Sequence[str]] = None,
    attachments: Optional[Sequence[Any]] = None,
    label: str = "chat",
    note_override: Optional[str] = None,
) -> str:
    """Убирает из промпта только те файлы, которые обработает плагин."""
    text, owned = strip_plugin_owned_attachments(
        inline_context or "",
        plugin_ids=plugin_ids,
        attachments=attachments,
        note_override=note_override,
    )
    if owned:
        logger.info(
            "[inline_context] %s: содержимое %s не вставлено в промпт (уходит в сервис плагина), "
            "осталось %s символов",
            label,
            owned,
            len(text),
        )
    return text


__all__ = [
    "attachment_names",
    "prepare_inline_context",
    "strip_plugin_owned_attachments",
]

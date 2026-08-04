"""Metadata-фильтры из текста запроса отключены.

Раньше эвристики (год «2024», «файл X.pdf») резали корпус по ``created_at`` /
``filename`` и давали пустой CONTEXT. Функция оставлена как no-op для
обратной совместимости импортов.
"""

from __future__ import annotations

from typing import Any, Dict, Optional


def extract_filters_from_query(text: str) -> Optional[Dict[str, Any]]:
    """Всегда None — фильтры по метаданным из текста больше не применяются."""
    return None

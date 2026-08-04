"""Relevance для UI карточек чанков — шкала как в LibreChat.

LibreChat: ``relevance = 1.0 - distance`` (cosine similarity ∈ [0, 1]),
в UI: ``Math.round(relevance * 100)%``.

У нас SVC-RAG отдаёт:
  * cosine similarity ∈ [0, 1] — vector / raw_cosine;
  * RRF ~0.01 — hybrid до реранка;
  * логит cross-encoder — после реранка (может быть <0 или >1).

Для cosine — LibreChat-формула. Иначе — относительная нормализация
внутри выдачи (лучший = 100, худший ≥ 1), чтобы не показывать «заоблачные»
логиты и микроскопические RRF.
"""

from __future__ import annotations

import math
from typing import Iterable, List, Sequence, Union

Number = Union[int, float]


def score_to_relevance_percent(score: Number) -> int:
    """Один score → целое 1..100 (для одиночного хита / cosine)."""
    try:
        s = float(score)
    except (TypeError, ValueError):
        return 1
    if math.isnan(s) or math.isinf(s):
        return 1
    if 0.0 <= s <= 1.0:
        pct = int(round(s * 100.0))
    else:
        # Логит реранкера → (0, 1) через sigmoid, затем проценты.
        pct = int(round(100.0 / (1.0 + math.exp(-s))))
    return max(1, min(100, pct if pct > 0 else 1))


def scores_to_relevance_percents(scores: Sequence[Number]) -> List[int]:
    """Пакетная конверсия: cosine → absolute %, RRF/логиты → relative 1..100."""
    if not scores:
        return []
    vals: List[float] = []
    for s in scores:
        try:
            vals.append(float(s))
        except (TypeError, ValueError):
            vals.append(0.0)

    lo = min(vals)
    hi = max(vals)
    all_in_unit = all(0.0 <= v <= 1.0001 for v in vals)
    # Cosine similarity обычно даёт релевантные хиты ≥ ~0.08–0.15.
    # RRF после fusion — микро-скоры ~0.01–0.03 → относительная шкала.
    looks_like_cosine = all_in_unit and hi >= 0.08
    if looks_like_cosine:
        return [score_to_relevance_percent(v) for v in vals]

    if hi <= lo:
        return [100] * len(vals)
    out: List[int] = []
    for v in vals:
        pct = int(round(1.0 + 99.0 * (v - lo) / (hi - lo)))
        out.append(max(1, min(100, pct)))
    return out


def attach_relevance_percents(
    hits: Iterable[tuple],
) -> List[tuple]:
    """Удобный хелпер: (content, score, ...) → список percent по score."""
    rows = list(hits)
    percents = scores_to_relevance_percents([r[1] for r in rows])
    return list(zip(rows, percents))

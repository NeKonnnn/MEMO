"""Порог после реранка и расширение чанка соседями (sentence window)."""

from __future__ import annotations

import logging
from typing import Any, List, Optional, Tuple

from app.services.hit_types import RagHit

logger = logging.getLogger(__name__)

HitRow = Tuple[str, float, Optional[int], Optional[int]]


def _keep(row: HitRow, content: str) -> HitRow:
    """Строка с новым текстом, не теряя сырой cosine у ```RagHit```."""
    if isinstance(row, RagHit):
        return row.with_content(content)
    return (content, row[1], row[2], row[3])


async def apply_rerank_min_and_window(
    vector_repo: Any,
    rows: List[HitRow],
    *,
    rerank_min_score: float,
    sentence_window: int,
    used_rerank: bool,
) -> List[HitRow]:
    out = list(rows)
    if used_rerank and rerank_min_score > 0:
        out = [r for r in out if float(r[1]) >= rerank_min_score]
        logger.debug("После RAG_RERANK_MIN_SCORE=%s осталось %s хитов", rerank_min_score, len(out))
    if sentence_window <= 0 or not out:
        return out
    expanded: List[HitRow] = []
    get_chunks = getattr(vector_repo, "get_chunk_contents_by_indices", None)
    if not get_chunks:
        return out
    for row in out:
        content, __dict__score, doc_id, chunk_idx = row
        if doc_id is None or chunk_idx is None:
            expanded.append(row)
            continue
        neigh = [int(chunk_idx) + d for d in range(-sentence_window, sentence_window + 1) if int(chunk_idx) + d >= 0]
        try:
            cmap = await get_chunks(int(doc_id), neigh)
        except Exception as e:
            logger.debug("sentence_window fetch failed: %s", e)
            expanded.append(row)
            continue
        if not cmap:
            expanded.append(row)
            continue
        merged = "\n---\n".join(cmap[i] for i in sorted(cmap.keys()))
        expanded.append(_keep(row, merged))
    return expanded

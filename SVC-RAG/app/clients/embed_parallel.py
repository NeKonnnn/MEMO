"""Параллельный прогон embed-батчей с сохранением порядка текстов.

concurrency=1 — как раньше (строго последовательно).
concurrency>1 — до N одновременных POST /embeddings (Semaphore).

Порядок гарантируется слотом results[i]: батчи могут завершиться в любом
порядке, но склейка всегда идёт по возрастанию i (т.е. по start в texts).
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import time
from typing import Awaitable, Callable, List, Optional, Sequence, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

EmbedBatchFn = Callable[[int, List[str]], Awaitable[List[List[float]]]]

# Подробный лог проверки порядка (по умолчанию вкл.). K8s: RAG_EMBED_ORDER_LOG=0 — выкл.
_ORDER_LOG = str(os.getenv("RAG_EMBED_ORDER_LOG", "1")).strip().lower() not in (
    "0",
    "false",
    "no",
)


def _text_fp(text: str) -> str:
    raw = (text or "").encode("utf-8", errors="replace")
    return hashlib.sha1(raw).hexdigest()[:10]


def _emb_fp(vec: Sequence[float]) -> str:
    if not vec:
        return "empty"
    # Несколько первых компонент + длина — достаточно, чтобы поймать перестановку.
    head = ",".join(f"{float(x):.5f}" for x in list(vec)[:4])
    return f"d{len(vec)}:{head}"


async def embed_texts_in_batches(
    texts: Sequence[str],
    *,
    batch_size: int,
    concurrency: int,
    embed_batch: EmbedBatchFn,
    log_prefix: str = "embed",
) -> List[List[float]]:
    """Разбить texts на батчи и прогнать embed_batch с ограниченным параллелизмом.

    embed_batch(start_index, batch_texts) -> embeddings той же длины, что batch.
    Результат склеивается в исходном порядке texts.
    """
    if not texts:
        return []
    bs = max(1, int(batch_size or 1))
    conc = max(1, int(concurrency or 1))
    batches: List[tuple[int, List[str]]] = []
    for start in range(0, len(texts), bs):
        batches.append((start, list(texts[start : start + bs])))

    n_batches = len(batches)
    if n_batches == 1 or conc == 1:
        out: List[List[float]] = []
        for bi, (start, batch) in enumerate(batches):
            if n_batches > 1:
                logger.debug(
                    "%s: батч %s–%s из %s (seq slot=%s)",
                    log_prefix,
                    start + 1,
                    start + len(batch),
                    len(texts),
                    bi,
                )
            part = await embed_batch(start, batch)
            if len(part) != len(batch):
                raise ValueError(
                    f"{log_prefix}: батч slot={bi} start={start}: "
                    f"эмбеддингов {len(part)} ≠ текстов {len(batch)}"
                )
            out.extend(part)
        if _ORDER_LOG:
            logger.debug(
                "%s: порядок векторов OK (mode=sequential, texts=%s batches=%s) "
                "склейка по возрастанию start",
                log_prefix,
                len(texts),
                n_batches,
            )
        return out

    sem = asyncio.Semaphore(conc)
    # Слоты строго по индексу батча — финиш out-of-order не ломает порядок.
    results: List[Optional[List[List[float]]]] = [None] * n_batches
    finish_order: List[int] = []
    finish_lock = asyncio.Lock()
    t0 = time.perf_counter()

    async def _one(i: int, start: int, batch: List[str]) -> None:
        async with sem:
            t_first = _text_fp(batch[0])
            t_last = _text_fp(batch[-1])
            logger.debug(
                "%s: батч %s–%s из %s (parallel conc=%s slot=%s "
                "text_fp[first]=%s text_fp[last]=%s)",
                log_prefix,
                start + 1,
                start + len(batch),
                len(texts),
                conc,
                i,
                t_first,
                t_last,
            )
            part = await embed_batch(start, batch)
            if len(part) != len(batch):
                raise ValueError(
                    f"{log_prefix}: батч slot={i} start={start}: "
                    f"эмбеддингов {len(part)} ≠ текстов {len(batch)}"
                )
            results[i] = part
            async with finish_lock:
                finish_order.append(i)
            if _ORDER_LOG:
                logger.debug(
                    "%s: слот %s готов (start=%s size=%s) "
                    "emb_fp[first]=%s emb_fp[last]=%s finish_seq=%s",
                    log_prefix,
                    i,
                    start,
                    len(part),
                    _emb_fp(part[0]),
                    _emb_fp(part[-1]),
                    list(finish_order),
                )

    await asyncio.gather(
        *(_one(i, start, batch) for i, (start, batch) in enumerate(batches))
    )
    elapsed = time.perf_counter() - t0

    out: List[List[float]] = []
    order_ok = True
    for i, (start, batch) in enumerate(batches):
        part = results[i]
        if part is None:
            raise RuntimeError(f"{log_prefix}: внутренний сбой параллельного embed (slot={i})")
        # Инвариант: часть i должна лечь ровно на texts[start:start+len]
        if len(out) != start:
            order_ok = False
            logger.error(
                "%s: ПОРЯДОК СЛОМАН перед слотом %s: len(out)=%s, ожидался start=%s",
                log_prefix,
                i,
                len(out),
                start,
            )
        out.extend(part)

    if len(out) != len(texts):
        raise ValueError(
            f"{log_prefix}: число эмбеддингов ({len(out)}) ≠ числу текстов ({len(texts)})"
        )

    # Точечная сверка границ батчей: вектор на abs_idx относится к texts[abs_idx].
    if _ORDER_LOG:
        for i, (start, batch) in enumerate(batches):
            part = results[i] or []
            for j in (0, len(batch) - 1):
                abs_idx = start + j
                same_text = texts[abs_idx] == batch[j]
                logger.debug(
                    "%s: align slot=%s idx=%s text_match=%s text_fp=%s emb_fp=%s",
                    log_prefix,
                    i,
                    abs_idx,
                    same_text,
                    _text_fp(batch[j]),
                    _emb_fp(part[j]),
                )
                if not same_text:
                    order_ok = False

    finish_sorted = sorted(finish_order) == list(range(n_batches))
    finish_was_sorted = finish_order == list(range(n_batches))
    if order_ok:
        logger.debug(
            "%s: порядок векторов OK (mode=parallel texts=%s batches=%s "
            "batch_size=%s concurrency=%s %.3fs) "
            "слоты склеены по возрастанию i; "
            "финиш батчей %s%s",
            log_prefix,
            len(texts),
            n_batches,
            bs,
            conc,
            elapsed,
            finish_order,
            ""
            if finish_was_sorted
            else " (out-of-order finish, порядок в out сохранён через slots)",
        )
    else:
        logger.error(
            "%s: порядок векторов НЕ OK finish_order=%s finish_covers_all=%s",
            log_prefix,
            finish_order,
            finish_sorted,
        )
        raise RuntimeError(
            f"{log_prefix}: проверка порядка векторов провалена (см. логи align/slots)"
        )
    return out

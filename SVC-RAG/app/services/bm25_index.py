"""In-memory BM25 индекс и гибридное объединение со скорами векторного поиска."""

from __future__ import annotations

import re
import time
from collections import OrderedDict
from typing import Any, Awaitable, Callable, Dict, List, Optional, Set, Tuple

from rank_bm25 import BM25Okapi

from app.core.logging import get_logger
from app.database.models import DocumentVector

logger = get_logger(__name__)

FetchContentsFn = Callable[[], Awaitable[List[Tuple[int, int, str]]]]
FetchChunkFn = Callable[[int, int], Awaitable[Optional[DocumentVector]]]

# Classic RRF constant (Cormack et al.). Не зависит от абсолютных шкал cosine/BM25.
RRF_K = 60

def tokenize_ru_en(text: str) -> List[str]:
    """Простая токенизация для BM25: по пробелам и пунктуации."""
    text = (text or "").lower()
    return re.findall(r"\b\w+\b", text)

def rrf_score(rank: int, rrf_k: int = RRF_K) -> float:
    """Reciprocal Rank Fusion вклад для 0-based rank."""
    return 1.0 / float(rrf_k + rank + 1)

class InMemoryBm25Index:
    """BM25Okapi над чанками хранилища; пересобирается по флагу needs_rebuild."""

    def __init__(self, fetch_contents: FetchContentsFn):
        self._fetch_contents = fetch_contents
        self.index: Optional[BM25Okapi] = None
        self.metadatas: List[Dict[str, Any]] = []
        # Раньше здесь лежал self.texts - полный текст всех чанков стора
        # Держим счётчик вместо корпуса
        self.chunk_count: int = 0
        self.needs_rebuild: bool = True

    @property
    def ready(self) -> bool:
        return self.index is not None and bool(self.metadatas)

    def release(self) -> None:
        """Отпустить построенный индекс."""
        self.index = None
        self.metadatas = []
        self.chunk_count = 0

    def mark_dirty(self) -> None:
        # Не только флаг: отпускаем индекс сразу. Раньше он оставался в памяти
        # до следующего поиска по этому стору - а если по стору больше никто не
        # искал, то навсегда
        self.needs_rebuild = True
        self.release()

    async def ensure_built(self) -> bool:
        if self.needs_rebuild or not self.index:
            await self.build()
        return self.ready

    async def build(self) -> None:
        t0 = time.perf_counter()
        try:
            rows = await self._fetch_contents()
            if not rows:
                logger.warning("Нет текстов для построения BM25 индекса")
                self.release()
                self.needs_rebuild = False
                return

            rows = list(rows)
            metadatas: List[Dict[str, Any]] = [
                {"document_id": d, "chunk": c} for d, c, _ in rows
            ]
            total = len(rows)

            def _corpus():
                """Токены по одному, с немедленным освобождением строки.

                BM25Okapi._initialize перебирает корпус и ни разу не берёт от
                него len(), поэтому генератор ему подходит. Это важно: раньше
                на пике в памяти лежали одновременно весь сырой текст из БД и
                все списки токенов, и только потом - словари частот. Теперь
                каждая строка отпускается сразу после токенизации.
                """
                for i in range(total):
                    _d, _c, content = rows[i]
                    rows[i] = None
                    yield tokenize_ru_en(content)

            # Корпус BM25Okapi у себя не хранит: строит doc_freqs, idf и doc_len.
            self.index = BM25Okapi(_corpus())
            del rows

            self.metadatas = metadatas
            self.chunk_count = total
            self.needs_rebuild = False
            logger.info(
                "BM25 индекс построен: %s чанков за %.3fs",
                total,
                time.perf_counter() - t0,
            )
        except Exception as e:
            logger.error("Ошибка построения BM25 индекса: %s", e)
            self.release()
            self.needs_rebuild = False

    async def search(self, query: str, k: int) -> List[Tuple[int, int, float]]:
        """Возвращает список (document_id, chunk_index, score)."""
        if not await self.ensure_built() or not self.index:
            return []
        try:
            q_tokens = tokenize_ru_en(query)
            if not q_tokens:
                return []
            scores = self.index.get_scores(q_tokens)
            top_indices = sorted(
                range(len(scores)), key=lambda i: scores[i], reverse=True
            )[:k]
            results: List[Tuple[int, int, float]] = []
            for idx in top_indices:
                meta = self.metadatas[idx]
                score = float(scores[idx])
                if score <= 0:
                    continue
                results.append((meta["document_id"], meta["chunk"], score))
            return results
        except Exception as e:
            logger.error("Ошибка BM25 поиска: %s", e)
            return []

class Bm25IndexCache:
    """Кэш индексов с вытеснением по давности использования.

    Сервисы SVC-RAG - синглтоны на процесс (см. app/dependencies.py), поэтому
    без вытеснения каждый проект, по которому хоть раз искали, держал бы свой
    корпус в памяти до перезапуска пода. Сто проектов - сто индексов.

    Вытесненный индекс не теряется: при следующем обращении он соберётся
    заново из БД. Платим одним медленным запросом вместо постоянной памяти.
    """

    def __init__(self, max_size: int):
        self._max = max(1, int(max_size))
        self._items: "OrderedDict[Any, InMemoryBm25Index]" = OrderedDict()

    def __len__(self) -> int:
        return len(self._items)

    def get_or_create(
        self, key: Any, factory: Callable[[], InMemoryBm25Index]
    ) -> InMemoryBm25Index:
        idx = self._items.get(key)
        if idx is not None:
            self._items.move_to_end(key)
            return idx
        idx = factory()
        self._items[key] = idx
        self._evict()
        return idx

    def values(self) -> List[InMemoryBm25Index]:
        return list(self._items.values())

    def items(self) -> List[Tuple[Any, InMemoryBm25Index]]:
        return list(self._items.items())

    def drop(self, predicate: Callable[[Any], bool]) -> int:
        """Убрать индексы, ключ которых подходит под условие, и отпустить память."""
        keys = [k for k in self._items if predicate(k)]
        for k in keys:
            idx = self._items.pop(k, None)
            if idx is not None:
                idx.release()
        return len(keys)

    def _evict(self) -> None:
        while len(self._items) > self._max:
            key, idx = self._items.popitem(last=False)
            idx.release()
            logger.debug(
                "BM25: вытеснен индекс %s (в кэше держим не больше %d)",
                key,
                self._max,
            )

async def hybrid_combine_vector_bm25(
    query: str,
    vector_pairs: List[Tuple[DocumentVector, float]],
    k: int,
    *,
    bm25_index: InMemoryBm25Index,
    bm25_weight: float,
    fetch_chunk: FetchChunkFn,
    document_id: Optional[int] = None,
    allowed_document_ids: Optional[Set[int]] = None,
) -> List[Tuple[DocumentVector, float]]:
    """Гибрид vector+BM25 через weighted RRF (не max-norm linear blend).

    Почему не ```(1-w)*norm_vec + w*norm_bm25```:
      - max-norm внутри каждого списка даёт BM25-only потолок ```w``` (часто 0.35),
        а top-1 vector — ```1-w``` (0.65). Векторный шум всегда побеждает sparse hit.
      - Cosine ∈ ~[0,1] и сырой BM25 — разные шкалы; деление на max не делает их
        сопоставимыми по смыслу.

    RRF (Cormack et al.) работает по **рангам**, поэтому шкалы не смешиваются:
      score = (1-w)/(RRF_K+rank_vec) + w/(RRF_K+rank_bm25)
    Документ только в одном списке получает вклад только от него — на равных
    рангах sparse и dense сопоставимы; документы в обоих списках получают бонус.
    """
    # Best practice (LangChain EnsembleRetriever / Qdrant hybrid):
    # параллельно top-N из dense и sparse, затем weighted RRF (k=60).
    # Веса: bm25_weight — вклад sparse; (1-w) — dense. Дефолт ~0.35/0.65.
    w = max(0.0, min(1.0, float(bm25_weight)))
    w_vec = 1.0 - w
    # Симметричный пул кандидатов: не меньше k*3 и не меньше 48 с каждой стороны.
    pool = max(int(k) * 3, 48)
    bm25_results = await bm25_index.search(query, pool)
    # Индекс общий на всю таблицу - сужаем до разрешенных документов
    if document_id is not None:
        bm25_results = [row for row in bm25_results if int(row[0]) == int(document_id)]
    elif allowed_document_ids is not None:
        bm25_results = [
            row for row in bm25_results if int(row[0]) in allowed_document_ids
        ]

    # Dense тоже ограничиваем тем же pool (входной список может быть шире).
    vector_sorted = sorted(vector_pairs, key=lambda x: float(x[1]), reverse=True)[:pool]

    if not vector_sorted and not bm25_results:
        return []

    # Ранги 0-based по исходному порядку (уже отсортированы по убыванию скора).
    vec_rank: Dict[Tuple[int, int], int] = {}
    vec_raw: Dict[Tuple[int, int], float] = {}
    vec_obj: Dict[Tuple[int, int], DocumentVector] = {}
    for rank, (v, sc) in enumerate(vector_sorted):
        key = (int(v.document_id), int(v.chunk_index))
        if key in vec_rank:
            continue
        vec_rank[key] = rank
        vec_raw[key] = float(sc)
        vec_obj[key] = v

    bm25_rank: Dict[Tuple[int, int], int] = {}
    bm25_raw: Dict[Tuple[int, int], float] = {}
    for rank, (doc_id, chunk_index, sc) in enumerate(bm25_results):
        key = (int(doc_id), int(chunk_index))
        if key in bm25_rank:
            continue
        bm25_rank[key] = rank
        bm25_raw[key] = float(sc)

    all_keys = set(vec_rank.keys()) | set(bm25_rank.keys())
    max_vec = max(vec_raw.values(), default=1.0) or 1.0
    max_bm25 = max(bm25_raw.values(), default=1.0) or 1.0

    combined: List[Tuple[DocumentVector, float]] = []
    for key in all_keys:
        score = 0.0
        if key in vec_rank:
            score += w_vec * rrf_score(vec_rank[key])
        if key in bm25_rank:
            score += w * rrf_score(bm25_rank[key])

        # Микро-тайбрейк по нормализованным сырым скорам (не влияет на порядок RRF
        # между разными рангами, только разделяет почти равные RRF).
        tie = 0.0
        if key in vec_raw:
            tie += w_vec * (vec_raw[key] / max_vec)
        if key in bm25_raw:
            tie += w * (bm25_raw[key] / max_bm25)
        score += 1e-6 * tie

        vec = vec_obj.get(key)
        if vec is None:
            vec = await fetch_chunk(key[0], key[1])
            if isinstance(vec, tuple):
                vec = vec[0]
            if not vec:
                continue
        combined.append((vec, float(score)))

    combined.sort(key=lambda x: x[1], reverse=True)
    top = combined[:k]
    # --- Гарантированные слоты sparse-канала ---
    # Weighted RRF при w<0.5 математически не пускает BM25-only хиты в top-k
    # (лучший BM25-хит проигрывает dense-кандидату вплоть до ранга ~61*(1-2w)/w).
    # Поэтому top-N хитов BM25 гарантированно получают места в выдаче,
    # N = round(k*w) (минимум 1). Хиты, уже попавшие в top по RRF, занимают слот.
    if bm25_results and top and w > 0:
        slots = max(1, int(round(k * w)))
        top_keys = {(int(v.document_id), int(v.chunk_index)) for v, _ in top}
        injected: List[Tuple[DocumentVector, float]] = []
        satisfied = 0
        for doc_id, chunk_index, _sc in bm25_results:
            if satisfied >= slots:
                break
            key = (int(doc_id), int(chunk_index))
            if key in top_keys:
                satisfied += 1
                continue
            vec = vec_obj.get(key)
            if vec is None:
                vec = await fetch_chunk(key[0], key[1])
                if isinstance(vec, tuple):
                    vec = vec[0]
            if not vec:
                continue
            injected.append((vec, w * rrf_score(bm25_rank.get(key, 0))))
            top_keys.add(key)
            satisfied += 1
        if injected:
            keep = max(0, k - len(injected))
            top = top[:keep] + injected
            top.sort(key=lambda x: x[1], reverse=True)
            logger.debug(
                "[hybrid] sparse-гарантия: добавлено %d BM25-хитов в top-%d (slots=%d)",
                len(injected),
                k,
                slots,
            )
    return top
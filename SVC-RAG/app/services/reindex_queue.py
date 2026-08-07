"""
Очередь перечанковки: поколение на сущность вместо одного на весь сервис.

Было: один счётчик поколений и один лок на стор. Старт пересборки агента B
поднимал счётчик, и пересборка агента A прерывалась на ближайшей проверке —
агент A оставался наполовину перечанкованным, без единого признака в интерфейсе.

Стало: поколение у каждого ключа своё. Повторный запуск ТОГО ЖЕ агента отменяет
его предыдущий проход (настройки успели поменяться — старый прогон не нужен),
соседей не трогает. Параллельно работает не больше ``RAG_REINDEX_MAX_PARALLEL``
задач: каждая держит в памяти свою модель эмбеддингов, и без предела сервис
моделей ляжет.

Кластерный прогон (без фильтра, после смены dim) остаётся эксклюзивным: он
поднимает поколение всем ключам и забирает все слоты сразу.
"""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional

from app.core.logging import get_logger

logger = get_logger(__name__)

# Ключ кластерного прогона: «всё сразу».
GLOBAL_KEY = "*"

_DEFAULT_MAX_PARALLEL = 2


def max_parallel() -> int:
    """Сколько сущностей пересобирается одновременно. 0 и мусор — дефолт."""
    raw = (os.getenv("RAG_REINDEX_MAX_PARALLEL", "") or "").strip()
    if not raw:
        return _DEFAULT_MAX_PARALLEL
    try:
        value = int(raw)
    except ValueError:
        logger.warning(
            "RAG_REINDEX_MAX_PARALLEL=%r не число — используем %s", raw, _DEFAULT_MAX_PARALLEL
        )
        return _DEFAULT_MAX_PARALLEL
    if value < 1:
        logger.warning(
            "RAG_REINDEX_MAX_PARALLEL=%s меньше 1 — используем %s", value, _DEFAULT_MAX_PARALLEL
        )
        return _DEFAULT_MAX_PARALLEL
    return value


def entity_key(scope: str, entity_id: Optional[Any]) -> str:
    """Ключ сущности: agent:<id> / project:<pid> / owner:<uid>."""
    sc = (scope or "").strip().lower() or "entity"
    eid = str(entity_id if entity_id is not None else "").strip()
    return f"{sc}:{eid}" if eid else GLOBAL_KEY


class ReindexQueue:
    """Поколения, предел параллелизма и реестр активных задач одного стора."""

    def __init__(self, store: str):
        self.store = store
        self._generations: Dict[str, int] = {}
        self._active: Dict[str, Dict[str, Any]] = {}
        self._limit = max_parallel()
        self._slots = asyncio.Semaphore(self._limit)
        # Чтобы два кластерных прогона не разбирали слоты навстречу друг другу
        # и не встали в клинч, каждый забрав половину.
        self._cluster_lock = asyncio.Lock()

    # --- поколения ---------------------------------------------------------

    def bump(self, key: str) -> int:
        """Новое поколение ключа — сигнал его текущему проходу прерваться."""
        if key == GLOBAL_KEY:
            return self._bump_all()
        self._generations[key] = self._generations.get(key, 0) + 1
        return self._generations[key]

    def _bump_all(self) -> int:
        """Кластерный прогон отменяет всё: его нарезка накроет те же документы."""
        for existing in list(self._generations):
            self._generations[existing] = self._generations.get(existing, 0) + 1
        self._generations[GLOBAL_KEY] = self._generations.get(GLOBAL_KEY, 0) + 1
        return self._generations[GLOBAL_KEY]

    def current(self, key: str) -> int:
        return self._generations.get(key, 0)

    def is_current(self, key: str, generation: Optional[int]) -> bool:
        """Актуален ли проход. ``None`` — проверка не запрашивалась."""
        if generation is None:
            return True
        return generation == self._generations.get(key, 0)

    # --- выполнение --------------------------------------------------------

    async def run(
        self,
        key: str,
        generation: int,
        job: Callable[[], Awaitable[Any]],
        *,
        meta: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Выполнить задачу, соблюдая предел параллелизма.

        Пока задача ждёт слот, её поколение может устареть — тогда она просто не
        стартует: смысла нет, следом идёт та же сущность с новыми настройками.
        """
        exclusive = key == GLOBAL_KEY
        if self._slots.locked() and not exclusive:
            logger.info(
                "[REINDEX %s] очередь: %s ждёт свободный слот (активно %s из %s)",
                self.store,
                key,
                len(self._active),
                self._limit,
            )
        async with self._acquire(exclusive):
            if not self.is_current(key, generation):
                logger.info(
                    "[REINDEX %s] пропуск %s: пока ждали очередь, поколение устарело",
                    self.store,
                    key,
                )
                return
            self._active[key] = {
                "key": key,
                "started_at": time.time(),
                **(meta or {}),
            }
            logger.info(
                "[REINDEX %s] старт %s (активно %s из %s)",
                self.store,
                key,
                len(self._active),
                self._limit,
            )
            try:
                await job()
            except Exception:
                logger.exception("[REINDEX %s] задача %s упала", self.store, key)
            finally:
                self._active.pop(key, None)
                logger.info(
                    "[REINDEX %s] завершено %s (осталось активных %s)",
                    self.store,
                    key,
                    len(self._active),
                )

    def _acquire(self, exclusive: bool):
        return _AllSlots(self) if exclusive else _OneSlot(self)

    # --- статус ------------------------------------------------------------

    def busy(self) -> bool:
        return bool(self._active)

    def cluster_running(self) -> bool:
        """Идёт кластерный прогон — только при нём поиск имеет смысл отбивать."""
        return GLOBAL_KEY in self._active

    def active(self) -> List[Dict[str, Any]]:
        return [dict(v) for v in self._active.values()]

    def status(self) -> Dict[str, Any]:
        """Статус для API. Старые поля сохранены — их читает прежний backend."""
        active = self.active()
        owner = None
        if len(active) == 1:
            owner = active[0].get("owner_user_id")
        return {
            "reindexing": self.busy(),
            "owner_user_id": None if self.cluster_running() else owner,
            "active": active,
            "max_parallel": self._limit,
        }


class _OneSlot:
    """Один слот семафора на время задачи."""

    def __init__(self, queue: ReindexQueue):
        self.queue = queue

    async def __aenter__(self):
        await self.queue._slots.acquire()
        return self

    async def __aexit__(self, *exc):
        self.queue._slots.release()
        return False


class _AllSlots:
    """Все слоты сразу — кластерный прогон работает в одиночку."""

    def __init__(self, queue: ReindexQueue):
        self.queue = queue
        self._taken = 0

    async def __aenter__(self):
        await self.queue._cluster_lock.acquire()
        try:
            for _ in range(self.queue._limit):
                await self.queue._slots.acquire()
                self._taken += 1
        except BaseException:
            for _ in range(self._taken):
                self.queue._slots.release()
            self._taken = 0
            self.queue._cluster_lock.release()
            raise
        return self

    async def __aexit__(self, *exc):
        for _ in range(self._taken):
            self.queue._slots.release()
        self._taken = 0
        self.queue._cluster_lock.release()
        return False


kb_queue = ReindexQueue("kb")
project_queue = ReindexQueue("project")

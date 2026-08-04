"""Пошаговые замеры RAG/LLM на стороне astrachat-backend."""

from __future__ import annotations

import time
from contextlib import contextmanager
from typing import Any, Dict, Iterator, List, Optional, Tuple


class StageTimer:
    def __init__(self, kind: str, *, store: str = "", **meta: Any) -> None:
        self.kind = (kind or "").strip() or "OP"
        self.store = (store or "").strip()
        self.meta = dict(meta)
        self._t0 = time.perf_counter()
        self._stages: List[Tuple[str, float]] = []
        self._active: Optional[Tuple[str, float]] = None

    @contextmanager
    def stage(self, name: str) -> Iterator[None]:
        name = (name or "unknown").strip() or "unknown"
        if self._active is not None:
            prev, started = self._active
            self._stages.append((prev, time.perf_counter() - started))
            self._active = None
        started = time.perf_counter()
        self._active = (name, started)
        try:
            yield
        finally:
            if self._active and self._active[0] == name:
                self._stages.append((name, time.perf_counter() - started))
                self._active = None

    def mark(self, name: str, seconds: float) -> None:
        self._stages.append(((name or "unknown").strip() or "unknown", max(0.0, float(seconds))))

    def items(self) -> List[Tuple[str, float]]:
        return list(self._stages)

    def elapsed(self) -> float:
        return time.perf_counter() - self._t0

    def format_line(self) -> str:
        total = self.elapsed()
        parts = [f"{name}={sec:.3f}s" for name, sec in self._stages]
        stages = " | ".join(parts) if parts else "(нет стадий)"
        label = f"[RAG-TIMING {self.kind}"
        if self.store:
            label += f" {self.store}"
        label += "]"
        meta_bits: List[str] = []
        for key, val in self.meta.items():
            if val is None or val == "":
                continue
            meta_bits.append(f"{key}={val!r}" if key == "file" else f"{key}={val}")
        meta_s = (" " + " ".join(meta_bits)) if meta_bits else ""
        return f"{label}{meta_s} total={total:.3f}s | {stages}"

    def log(self, logger: Any, *, level: int = 20) -> None:
        try:
            logger.log(level, self.format_line())
        except Exception:
            pass

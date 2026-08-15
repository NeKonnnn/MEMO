"""Единый бюджет CONTEXT для RAG → LLM.

Меняйте лимит только здесь (или через env) — все call-sites берут
```rag_context_max_chars(store)```.

256 000 токенов — потолок на один store при сборке фрагментов.
Перевод в символы: консервативно 4 символа ≈ 1 токен (ru/en mix).

Лимит настраивается ПОСТОРОВО, чтобы проектному RAG можно было дать бюджет,
отличный от библиотеки памяти, не пересобирая образ:

    RAG_CONTEXT_MAX_TOKENS            общий дефолт для всех сторов
    RAG_CONTEXT_MAX_TOKENS_PROJECT    проектный RAG
    RAG_CONTEXT_MAX_TOKENS_KB         База знаний. Она же «агентный RAG»:
    RAG_CONTEXT_MAX_TOKENS_AGENT      синоним KB (поиск в KB всегда идёт по
                                      документам агента) — задавайте любую
    RAG_CONTEXT_MAX_TOKENS_MEMORY     библиотека памяти («глобальный»)

Пусто или мусор в переменной — берётся общий дефолт. Значение зажимается
в [1000, 2 000 000] токенов: опечатка в ConfigMap не должна ни обнулить
контекст, ни отправить в LLM гигабайт.
"""

from __future__ import annotations

import os
from typing import Dict, Optional, Tuple

# Канонический лимит. Переопределение: RAG_CONTEXT_MAX_TOKENS.
RAG_CONTEXT_MAX_TOKENS: int = 256_000

# Грубая оценка символов на токен. Переопределение: RAG_CHARS_PER_TOKEN.
_DEFAULT_CHARS_PER_TOKEN: float = 4.0

_TOKENS_LO = 1000
_TOKENS_HI = 2_000_000

# store -> переменные окружения в порядке приоритета.
# Сначала имена memo, затем алиасы GPB (ConfigMap из ASTRA).
_STORE_ENV: Dict[str, Tuple[str, ...]] = {
    "project": (
        "RAG_CONTEXT_MAX_TOKENS_PROJECT",
        "RAG_CONTEXT_PROJECT_MAX_TOKENS",
    ),
    "kb": (
        "RAG_CONTEXT_MAX_TOKENS_KB",
        "RAG_CONTEXT_MAX_TOKENS_AGENT",
        "RAG_CONTEXT_KNOWLEDGE_BASE_MAX_TOKENS",
        "RAG_CONTEXT_AGENT_MAX_TOKENS",
    ),
    "agent": (
        "RAG_CONTEXT_MAX_TOKENS_AGENT",
        "RAG_CONTEXT_MAX_TOKENS_KB",
        "RAG_CONTEXT_AGENT_MAX_TOKENS",
        "RAG_CONTEXT_KNOWLEDGE_BASE_MAX_TOKENS",
        "RAG_CONTEXT_KB_MAX_TOKENS",
    ),
    "memory": (
        "RAG_CONTEXT_MAX_TOKENS_MEMORY",
        "RAG_CONTEXT_MEMORY_MAX_TOKENS",
    ),
}

def _env_int(name: str, default: int, *, lo: int, hi: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return max(lo, min(default, hi))
    try:
        return max(lo, min(int(raw), hi))
    except ValueError:
        return max(lo, min(default, hi))

def _env_float(name: str, default: float, *, lo: float, hi: float) -> float:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return max(lo, min(default, hi))
    try:
        return max(lo, min(float(raw), hi))
    except ValueError:
        return max(lo, min(default, hi))

def store_key(store: Optional[str]) -> Optional[str]:
    """Ключ стора из метки вида ```project (direct)``` или из готового ключа.
    Call-sites передают ту же строку, что уходит в ```store_label```, — так не
    приходится держать два справочника имён и они не разъедутся.
    """
    raw = str(store or "").strip().lower()
    if not raw:
        return None
    token = raw.split()[0].strip("()")
    return token if token in _STORE_ENV else None

def rag_context_max_tokens(store: Optional[str] = None) -> int:
    """Максимум токенов CONTEXT для стора (или общий, если стор не задан)."""
    fallback = _env_int(
        "RAG_CONTEXT_MAX_TOKENS",
        RAG_CONTEXT_MAX_TOKENS,
        lo=_TOKENS_LO,
        hi=_TOKENS_HI,
    )
    key = store_key(store)
    if not key:
        return fallback
    for env_name in _STORE_ENV[key]:
        if (os.getenv(env_name) or "").strip():
            return _env_int(env_name, fallback, lo=_TOKENS_LO, hi=_TOKENS_HI)
    return fallback

def rag_chars_per_token() -> float:
    return _env_float("RAG_CHARS_PER_TOKEN", _DEFAULT_CHARS_PER_TOKEN, lo=1.0, hi=16.0)

def rag_context_max_chars(store: Optional[str] = None) -> int:
    """Бюджет в символах для ```format_rag_fragments(..., max_chars=...)```."""
    return int(rag_context_max_tokens(store) * rag_chars_per_token())

def budget_overview() -> Dict[str, object]:
    """Действующие лимиты по сторам — для стартового лога и диагностики."""
    return {
        "chars_per_token": rag_chars_per_token(),
        "default_tokens": rag_context_max_tokens(),
        "by_store_tokens": {
            name: rag_context_max_tokens(name) for name in ("project", "kb", "memory")
        },
    }
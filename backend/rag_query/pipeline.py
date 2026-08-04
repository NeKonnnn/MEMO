"""Предобработка запроса: нормализация, опционально опечатки, HyDE, multi-query, фильтры."""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import os
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any, Dict, List, Optional

from backend.rag_query.metadata_filters import extract_filters_from_query
from backend.rag_query.preprocess import normalize_query
from backend.settings.logging import get_logger

logger = get_logger(__name__)

@dataclass
class ProcessedQuery:
    original: str
    normalized: str
    query_for_search: str
    vector_query: Optional[str]
    multi_variants: Optional[List[str]]
    filters: Optional[Dict[str, Any]]

def _cut(text: Optional[str], limit: int = 300) -> str:
    """Текст для лога: одной строкой и без простыней.

    Запрос и варианты влезают целиком, HyDE-абзацы обрезаются — в логе важен
    не весь сгенерированный текст, а то, что модель вообще придумала.
    """
    s = " ".join(str(text or "").split())
    return s if len(s) <= limit else f"{s[:limit]}…(+{len(s) - limit} симв.)"

def _hyde_max_chars() -> int:
    try:
        return max(200, min(8000, int(os.getenv("RAG_HYDE_MAX_CHARS", "2000"))))
    except ValueError:
        return 2000


def _typos_min_similarity() -> float:
    """Насколько «исправленный» запрос обязан остаться похожим на исходный.

    Шаг исправления опечаток ПОДМЕНЯЕТ запрос, по которому дальше идёт и
    лексический поиск, и multi-query, и HyDE. Модель охотно пересказывает
    вопрос вместо правки опечаток: 02.08 «Мы выдаем БГ новому клиенту, в
    полномочиях Бизнес…» превратилось в «Как поставить на мониторинг
    банкгарантию нового клиента…» — близость 0.31, общее слово одно из
    тринадцати. Настоящая правка опечаток даёт 0.9+, поэтому порог посередине.

    ```RAG_TYPOS_MIN_SIMILARITY=0``` — проверку выключить.
    """
    try:
        return max(0.0, min(1.0, float(os.getenv("RAG_TYPOS_MIN_SIMILARITY", "0.6"))))
    except ValueError:
        return 0.6


async def _llm_short(prompt: str, system: str, max_tokens: int = 512) -> str:
    """Короткий служебный вызов LLM. Пустая строка = не получилось.

    ```ask_agent``` при сбое возвращает НЕ исключение, а человекочитаемый текст
    ошибки. Для чата это правильно, а здесь — яд: 01.08 строка «Не удалось
    получить ответ от модели…» прошла проверку длины и заменила собой запрос
    пользователя, после чего поиск шёл по тексту ошибки. Поэтому результат
    проверяется и в таком случае обнуляется.
    """
    from backend.agent_llm_svc import ask_agent
    from backend.llm_providers.routing import is_llm_error_text

    loop = asyncio.get_running_loop()

    def _call() -> str:
        return ask_agent(
            prompt,
            history=[],
            streaming=False,
            system_prompt=system,
            max_tokens=max_tokens,
            service_call=True,
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
        raw = await loop.run_in_executor(ex, _call)
    if is_llm_error_text(raw):
        logger.warning(
            "[RAG-PREP] LLM вернула текст ошибки вместо ответа — шаг пропущен: %s",
            _cut(raw, 160),
        )
        return ""
    return raw or ""

async def process_user_query(
    user_text: str, *, fix_typos: bool = False, multi_query: bool = False, hyde: bool = False
) -> ProcessedQuery:
    original = user_text or ""
    normalized = normalize_query(original)
    q = normalized
    if normalized != original:
        logger.debug(
            "[RAG-PREP] нормализация: %r -> %r", _cut(original), _cut(normalized)
        )
    if fix_typos:
        try:
            fixed = await _llm_short(
                "Исправь ТОЛЬКО опечатки, ошибки раскладки и согласования. Больше ничего "
                "не меняй: не переформулируй, не сокращай, не дополняй, не раскрывай "
                "аббревиатуры, сохрани порядок слов и термины автора. Если опечаток нет — "
                "верни текст без изменений. Верни только текст запроса, одной строкой, "
                "без комментариев:\n\n" + q,
                "Ты нормализуешь пользовательский поисковый запрос.",
                max_tokens=256,
            )
            fixed = (fixed or "").strip().split("\n")[0].strip()
            min_sim = _typos_min_similarity()
            similarity = (
                SequenceMatcher(None, q.lower(), fixed.lower()).ratio()
                if fixed
                else 0.0
            )
            if not (2 < len(fixed) < len(q) * 3 and len(fixed) < 2000):
                # Модель вернула что-то неправдоподобное — берём исходный запрос.
                logger.debug(
                    "[RAG-PREP] опечатки: ответ модели отклонён (длина %s при исходной %s): %r",
                    len(fixed),
                    len(q),
                    _cut(fixed),
                )
            elif similarity < min_sim:
                # Пересказ вместо правки опечаток. Подменять им запрос нельзя:
                # по нему идёт лексический поиск, и слова пользователя теряются.
                logger.debug(
                    "[RAG-PREP] опечатки: ответ отклонён как переформулировка "
                    "(близость %.2f < %.2f): %r -> %r",
                    similarity,
                    min_sim,
                    _cut(q),
                    _cut(fixed),
                )
            else:
                if fixed != q:
                    logger.debug(
                        "[RAG-PREP] опечатки исправлены (близость %.2f): %r -> %r",
                        similarity,
                        _cut(q),
                        _cut(fixed),
                    )
                else:
                    logger.debug("[RAG-PREP] опечатки: правок нет")
                q = fixed
        except Exception:
            logger.exception("RAG_QUERY_FIX_TYPOS")
    filters = extract_filters_from_query(q)
    vector_query: Optional[str] = None
    multi_variants: Optional[List[str]] = None
    if multi_query:
        try:
            raw = await _llm_short(
                'Сгенерируй 3–5 коротких альтернативных формулировок для поиска по базе (тот же смысл и язык, что у запроса). Верни только JSON вида {"variants":["..."]} без markdown.\n\nЗапрос:\n'
                + q,
                "Отвечай только компактным JSON.",
                max_tokens=400,
            )
            m = re.search("\\{[\\s\\S]*\\}", raw or "")
            if m:
                data = json.loads(m.group())
                vars_ = data.get("variants") or []
                if isinstance(vars_, list) and vars_:
                    multi_variants = [str(x).strip() for x in vars_[:6] if str(x).strip()]
            if multi_variants:
                logger.debug(
                    "[RAG-PREP] multi-query придумал %s вариантов:\n%s",
                    len(multi_variants),
                    "\n".join(f"    {i}. {_cut(v)}" for i, v in enumerate(multi_variants, 1)),
                )
            else:
                logger.debug(
                    "[RAG-PREP] multi-query: вариантов не получено, сырой ответ: %r",
                    _cut(raw),
                )
        except Exception:
            logger.exception("RAG_MULTI_QUERY_ENABLED")
    if hyde:
        try:
            hyde = await _llm_short(
                "Напиши 1–3 коротких абзаца гипотетического ответа на запрос (как если бы ты знал тему). Не ссылайся на реальные документы, законы или источники по названию.\n\nЗапрос:\n"
                + q,
                "HyDE: гипотетический текст для плотного поиска.",
                max_tokens=400,
            )
            hyde = (hyde or "").strip()
            if len(hyde) > 30:
                cap = _hyde_max_chars()
                vector_query = f"{q}\n\n{hyde[:cap]}"
                logger.debug(
                    "[RAG-PREP] HyDE придумал гипотетический ответ (%s симв., "
                    "в вектор уйдёт %s): %s",
                    len(hyde),
                    min(len(hyde), cap),
                    _cut(hyde, 500),
                )
            else:
                logger.debug(
                    "[RAG-PREP] HyDE: текст слишком короткий (%s симв.), "
                    "вектор ищем по исходному запросу: %r",
                    len(hyde),
                    _cut(hyde),
                )
        except Exception:
            logger.exception("RAG_HYDE_ENABLED")
    if filters:
        logger.debug("[RAG-PREP] фильтры из запроса: %s", filters)
    logger.debug(
        "[RAG-PREP] итог препроцесса: fix_typos=%s, multi_query=%s (вариантов=%s), "
        "HyDE(vector_query=%s), filters=%s, query_for_search=%r",
        fix_typos,
        multi_query,
        len(multi_variants or []),
        bool(vector_query),
        bool(filters),
        _cut(q),
    )
    return ProcessedQuery(
        original=original,
        normalized=normalized,
        query_for_search=q,
        vector_query=vector_query,
        multi_variants=multi_variants,
        filters=filters,
    )
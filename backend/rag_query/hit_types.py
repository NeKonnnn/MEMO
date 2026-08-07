"""Хит RAG-поиска, который несёт сырой cosine рядом со скором ранжирования.

Зеркало 'SVC-RAG/app/services/hit_types.py': сервис отдаёт 'cosine'
отдельным полем в ответе '/search', backend кладёт его сюда и использует
для процента релевантности в карточках чанков.

Почему нельзя считать процент по 'score': это скор шкалы той стратегии,
которая отработала. cosine у 'vector'/'raw_cosine', weighted RRF
(~0.016) у 'hybrid' и auto-ветки с keyword-merge, логит cross-encoder
после реранка, BM25/max у 'lexical'. Проценты, посчитанные по такой
смеси, между запросами несопоставимы.

Наследование от 'tuple' — намеренно: хит распаковывается как
'content, score, document_id, chunk_index' в десятках мест
('format_rag_fragments', 'filter_rag_hits_by_score',
'dedupe_rag_hits', обработчики чата). 'RagHit' остаётся кортежем
ровно из четырёх элементов, поэтому существующий код работает без правок.
"""

from __future__ import annotations

from typing import Any, Optional

class RagHit(tuple):
    """```(content, score, document_id, chunk_index)``` + ```cosine```.

    ```__slots__``` не используется: для подклассов кортежа он запрещён
    (tuple — тип переменной длины).
    """

    def __new__(
        cls,
        content: str,
        score: float,
        document_id: Optional[int],
        chunk_index: Optional[int],
        cosine: Optional[float] = None,
    ) -> "RagHit":
        return super().__new__(cls, (content, score, document_id, chunk_index))

    def __init__(
        self,
        content: str,
        score: float,
        document_id: Optional[int],
        chunk_index: Optional[int],
        cosine: Optional[float] = None,
    ) -> None:
        self.cosine: Optional[float] = None if cosine is None else float(cosine)

def hit_cosine(hit: Any) -> Optional[float]:
    """Сырой cosine хита или None, если SVC-RAG его не прислал.

    None — нормальная ситуация: лексическая стратегия эмбеддинги не считает,
    а чанк, найденный только BM25 / entity lane, косинусной близости не имеет.
    Старый SVC-RAG без поля 'cosine' тоже даёт None — тогда процент
    считается по прежней эвристике.
    """
    value = getattr(hit, "cosine", None)
    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result
import asyncio
import logging
from typing import List, Optional, Union

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.dependencies.rag_models_handler import get_embedding_model
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

class EmbedRequest(BaseModel):
    text: Union[str, None] = None
    texts: Union[List[str], None] = None
    # Какой моделью эмбеддить: "FRIDA" или "local/FRIDA". None -> кластерный дефолт.
    model: Optional[str] = None
    # Асимметричные модели (FRIDA) кодируют запрос и документ по-разному:
    # "query" -> префикс search_query, "document" -> search_document.
    # None/неизвестное -> без префикса (как раньше). Модели без промптов не затрагиваются.
    kind: Optional[str] = None

    def get_texts(self) -> List[str]:
        if self.texts:
            return self.texts
        if self.text is not None:
            return [self.text]
        return []

class EmbedResponse(BaseModel):
    embeddings: List[List[float]]
    embedding_dim: int
    # Чем реально посчитано — для наблюдаемости и проверки на стороне svc-rag
    model: Optional[str] = None
    prompt: Optional[str] = None

def _prompt_name_for(model, kind: Optional[str]) -> Optional[str]:
    """Имя промпта для асимметричной модели, если она его знает.

    FRIDA объявляет промпты search_query / search_document. У моделей без промптов
    (Giga, MiniLM) словарь пуст — тогда возвращаем None и encode() зовём как раньше,
    иначе sentence-transformers ругнётся на неизвестный prompt_name.
    """
    if not kind:
        return None
    key = str(kind).strip().lower()
    rm = settings.rag_models
    mapping = {
        "query": rm.query_prompt_name,
        "search_query": rm.query_prompt_name,
        "document": rm.document_prompt_name,
        "doc": rm.document_prompt_name,
        "passage": rm.document_prompt_name,
        "search_document": rm.document_prompt_name,
    }
    name = mapping.get(key)
    if not name:
        return None
    prompts = getattr(model, "prompts", None) or {}
    try:
        return name if name in prompts else None
    except TypeError:
        return None

def _encode_texts(model, texts: List[str], batch_size: int, prompt_name: Optional[str]):
    kwargs = {
        "convert_to_numpy": True,
        "batch_size": batch_size,
        "show_progress_bar": len(texts) > batch_size,
    }
    if prompt_name:
        kwargs["prompt_name"] = prompt_name
    return model.encode(texts, **kwargs)

@router.post("/embed", response_model=EmbedResponse)
async def embed_texts(request: EmbedRequest):
    if not settings.rag_models.enabled:
        raise HTTPException(status_code=503, detail="Сервис RAG-моделей выключен")
    texts = request.get_texts()
    if not texts:
        raise HTTPException(
            status_code=400, detail="Нужно передать text или texts в теле запроса"
        )

    try:
        entry = await get_embedding_model(request.model)
    except ValueError as e:  # модель не разрешена конфигом
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(
            status_code=503, detail=f"Эмбеддинг-модель не загружена: {e}"
        ) from e

    model = entry["model"]
    model_name = entry.get("path", "").rstrip("/").split("/")[-1] or "?"
    batch_size = max(1, int(settings.rag_models.embed_batch_size))
    prompt_name = _prompt_name_for(model, request.kind)
    logger.info(
        "[EMBED] model=%s dim=%s kind=%s prompt=%s texts=%s batch_size=%s",
        model_name,
        entry.get('dim'),
        request.kind or "-",
        prompt_name or "-",
        len(texts),
        batch_size,
    )

    embeddings = await asyncio.to_thread(
        _encode_texts, model, texts, batch_size, prompt_name
    )
    if hasattr(embeddings, "ndim") and embeddings.ndim == 1:
        embeddings = [embeddings.tolist()]
    else:
        embeddings = embeddings.tolist()
    # Всегда берём фактическую длину вектора: конфиг мог устареть
    if embeddings and embeddings[0]:
        dim = len(embeddings[0])
        entry["dim"] = dim
    else:
        dim = int(entry.get("dim") or 384)
    return EmbedResponse(
        embeddings=embeddings,
        embedding_dim=int(dim),
        model=model_name,
        prompt=prompt_name,
    )
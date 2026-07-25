import asyncio
import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.dependencies.rag_models_handler import get_reranker_model
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

class RerankRequest(BaseModel):
    query: str
    passages: List[str]
    top_k: int = 20
    # Каким реранкером считать: "ms-marco-MiniLM-L6-v2" или "local/...". None -> дефолт.
    model: Optional[str] = None

class RerankResponse(BaseModel):
    indices: List[int]
    scores: List[float]
    model: Optional[str] = None

def _predict(model, pairs: List[List[str]]):
    return model.predict(pairs)

@router.post("/rerank", response_model=RerankResponse)
async def rerank_passages(request: RerankRequest):
    # Переранжируем по релевантности к запросу, возвращаем top_k индексов и скоры
    if not settings.rag_models.enabled:
        raise HTTPException(status_code=503, detail="Сервис RAG-моделей выключен")
    if not request.passages:
        return RerankResponse(indices=[], scores=[])

    try:
        entry = await get_reranker_model(request.model)
    except ValueError as e:  # модель не разрешена конфигом
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Реранкер не загружен: {e}") from e

    model = entry["model"]
    model_name = entry.get("path", "").rstrip("/").split("/")[-1] or "?"
    print(
        f"[RERANK] model={model_name} passages={len(request.passages)} top_k={request.top_k}",
        flush=True,
    )

    pairs = [[request.query, p] for p in request.passages]
    # В отдельном потоке: predict у CrossEncoder/LLM-реранкера блокирующий
    scores = await asyncio.to_thread(_predict, model, pairs)

    if hasattr(scores, "__len__") and len(scores) != len(request.passages):
        scores = list(scores)
    else:
        scores = scores.tolist() if hasattr(scores, "tolist") else list(scores)
    top_k = min(request.top_k, len(scores))
    indexed = list(enumerate(scores))
    indexed.sort(key=lambda x: x[1], reverse=True)
    top = indexed[:top_k]
    return RerankResponse(
        indices=[i for i, _ in top],
        scores=[float(s) for _, s in top],
        model=model_name,
    )
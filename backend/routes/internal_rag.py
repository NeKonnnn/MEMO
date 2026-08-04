"""
routes/internal_rag.py — внутренний LLM-прокси для SVC-RAG.
SVC-RAG не ходит в llm-service напрямую: любые его LLM-вызовы (judge, иерархическая
суммаризация) идут сюда, а backend выполняет их своей выбранной моделью (ask_agent).
Авторизация — сетевая изоляция (как и весь трафик backend↔svc-rag), токен не нужен.
"""

import asyncio
import concurrent.futures
from fastapi import APIRouter
from pydantic import BaseModel
from backend.settings.logging import get_logger

logger = get_logger(__name__)
router = APIRouter(tags=["internal-rag"])

class InternalRagLLMRequest(BaseModel):
    prompt: str
    purpose: str = "rag"
    temperature: float = 0.3
    max_tokens: int = 1024

@router.post("/api/internal/rag/llm")
async def internal_rag_llm(body: InternalRagLLMRequest):
    """Выполнить один LLM-вызов от имени SVC-RAG выбранной backend-моделью."""
    from backend.agent_llm_svc import ask_agent
    from backend.llm_providers.routing import is_llm_error_text

    prompt = body.prompt or ""
    loop = asyncio.get_running_loop()

    def _call() -> str:
        result = ask_agent(
            prompt,
            history=[],
            streaming=False,
            max_tokens=int(body.max_tokens),
            temperature=float(body.temperature),
            # Ответ читает svc-rag, а не человек: мышление не нужно и вредно —
            # reasoning-модель тратит на него весь бюджет токенов.
            service_call=True,
        )
        return result or ""

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            content = await loop.run_in_executor(ex, _call)
    except Exception as e:
        logger.exception("internal_rag_llm: ошибка вызова модели (purpose=%s)", body.purpose)
        return {"content": "", "error": str(e)}

    # ask_agent при сбое возвращает текст ошибки, а не исключение. Отдать его
    # как content нельзя: svc-rag запишет его в индекс как summary документа
    # (01.08 так и произошло — чанки с «Ошибка LLM (HTTP 422)» вместо текста).
    if is_llm_error_text(content):
        logger.warning(
            "internal_rag_llm: модель вернула текст ошибки (purpose=%s): %s",
            body.purpose,
            str(content)[:200],
        )
        return {"content": "", "error": str(content)[:400]}

    logger.debug(
        "[internal_rag_llm] purpose=%s prompt_chars=%s content_chars=%s "
        "(модель не задана явно — берётся дефолтная чатовая, см. _pick_chat_model)",
        body.purpose,
        len(prompt),
        len(content or ""),
    )
    return {"content": content or ""}
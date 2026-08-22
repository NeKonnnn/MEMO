import json
import time
import uuid
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import logging.config

from app.core.config import settings
from app.api import router as api_router
from app.core.cef_logger import (
    CefAuditMiddleware,
    CefAuthMiddleware,
    configure_cef_logging,
    log_cef_event,
)
from app.dependencies.rag_models_handler import (
    get_rag_models_handler,
    cleanup_rag_models_handler,
    get_last_rag_models_error,
)

logging.config.dictConfig(
    {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {"default": {"format": settings.logging.format}},
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "default",
                "level": settings.logging.level,
            }
        },
        "root": {"handlers": ["console"], "level": settings.logging.level},
    }
)
logger = logging.getLogger(__name__)

configure_cef_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        if settings.rag_models.enabled:
            logger.info("Поднимаю сервис RAG-моделей (эмбеддинг + реранкер)...")
            handler = await get_rag_models_handler()
            if handler is None:
                err = get_last_rag_models_error()
                logger.error("RAG-модели не поднялись%s", f": {err}" if err else "")
            else:
                logger.info("Сервис RAG-моделей готов")
        log_cef_event("SYS001")
    except Exception as e:
        logger.error(f"Ошибка при старте: {e}", exc_info=True)
        raise
    yield
    log_cef_event("SYS002")
    await cleanup_rag_models_handler()
    logger.info("Сервис RAG-моделей остановлен")


def create_application() -> FastAPI:
    app = FastAPI(
        title=settings.app.title,
        description=settings.app.description,
        version=settings.app.version,
        lifespan=lifespan,
        docs_url=settings.server.docs_url,
        redoc_url=settings.server.redoc_url,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors.allowed_origins,
        allow_credentials=settings.cors.allow_credentials,
        allow_methods=settings.cors.allow_methods,
        allow_headers=settings.cors.allow_headers,
    )
    # CEF: auth (SEC001/SEC003) снаружи, затем OBJ001/OBJ002.
    app.add_middleware(CefAuditMiddleware)
    app.add_middleware(CefAuthMiddleware)
    app.include_router(api_router, prefix="/v1")
    return app


app = create_application()


@app.middleware("http")
async def log_requests(request: Request, call_next):
    request_id = str(uuid.uuid4())
    start = time.time()
    logger.info(f"Request {request_id}: {request.method} {request.url}")
    if request.method == "POST":
        try:
            body = await request.body()
            if body and "application/json" in (request.headers.get("content-type") or ""):
                try:
                    logger.info(
                        f"Request {request_id}: body=%s", json.dumps(json.loads(body), ensure_ascii=False)[:500]
                    )
                except Exception:
                    pass
        except Exception as e:
            logger.debug(f"Request {request_id}: body read error {e}")
    response = await call_next(request)
    logger.info(f"Request {request_id}: status={response.status_code} time={time.time() - start:.2f}s")
    return response


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.server.host,
        port=settings.server.port,
        log_level=settings.server.log_level.lower(),
    )

import uuid
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

# Единый формат логов со всеми сервисами astrachat (app.* + httpx + uvicorn в одном стиле).
# Настраиваем ДО импорта роутеров, чтобы их module-level логгеры тоже легли в единый формат.
from app.core.logging import configure_logging, get_logger, get_uvicorn_log_config
from app.core.cef_logger import CefAuditMiddleware, configure_cef_logging, log_cef_event

from app.core.config import get_settings, get_settings_diagnostics
from app.api import router as api_router
from app.dependencies import get_db

configure_logging()
configure_cef_logging()

settings = get_settings()
logger = get_logger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        diag = get_settings_diagnostics()
        logger.info(
            "SVC-RAG config source: requested=%s resolved=%s used_yaml=%s",
            diag.get("requested_config_path"),
            diag.get("resolved_config_path"),
            diag.get("used_yaml"),
        )
        logger.debug("SVC-RAG PostgreSQL effective config: %s", diag.get("postgresql"))
        logger.debug("SVC-RAG PostgreSQL env snapshot: %s", diag.get("env_values"))

        await get_db()
        logger.info("SVC-RAG: БД подключена, таблицы готовы")
        try:
            from app.dependencies import ensure_memory_chunk_consistency

            await ensure_memory_chunk_consistency()
        except Exception:
            logger.exception("[MEMORY-CHUNK] проверка нарезки Библиотеки не удалась")
        log_cef_event("SYS001")
    except Exception as e:
        logger.error("SVC-RAG: ошибка старта БД: %s", e, exc_info=True)
        raise
    yield
    log_cef_event("SYS002")
    logger.info("SVC-RAG: shutdown")

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
    # CEF после CORS: внутренний middleware выполняется первым на запросе.
    app.add_middleware(CefAuditMiddleware)
    app.include_router(api_router, prefix="/v1")
    return app

app = create_application()

@app.middleware("http")
async def log_requests(request: Request, call_next):
    request_id = str(uuid.uuid4())[:8]
    logger.debug("%s %s %s", request_id, request.method, request.url.path)
    response = await call_next(request)
    logger.debug(
        "%s %s %s %s",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
    )
    return response

if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.server.host,
        port=settings.server.port,
        log_config=get_uvicorn_log_config(),
    )
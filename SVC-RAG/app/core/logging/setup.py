"""
Централизованная настройка логирования SVC-RAG
Порт матрицы логов backend (backend.settings.logging) под SVC-RAG
"""

from __future__ import annotations
import logging
import logging.config
import os
import sys
from typing import Optional
from app.core.logging.matrix import DEFAULT_LEVEL, LEVEL_BY_NAME

# Корень иерархии логгеров сервиса (RAG-модули: logging.getLogger(__name__) -> "app.*").
APP_LOGGER_NAME = "app"
LOG_FORMAT = (
    "%(asctime)s,%(msecs)03d: [%(thread)d] [astra-chat-rag]"
    "[%(threadName)s][%(levelname)s][%(name)s:%(funcName)s(%(lineno)d)]: %(message)s"
)
LOG_DATEFMT = "%Y-%m-%d %H:%M:%S"
_UVICORN_LOGGERS = ("uvicorn", "uvicorn.error", "uvicorn.access")

# Библиотеки, у которых DEBUG означает «строка на каждый токен разбора».
# Вернуть подробность: RAG_LOG_NOISY_LEVEL=DEBUG.
_NOISY_LOGGERS = (
    "pdfminer",
    "pdfplumber",
    "PIL",
    "httpcore",
    "httpx",
    "urllib3",
    "asyncio",
    "multipart",
)

_configured = False

def _settings_logging():
    """Секция 'logging' из config.yml. Ошибка чтения - None."""
    try:
        from app.core.config import get_settings

        return getattr(get_settings(), "logging", None)
    except Exception:
        return None

def _level_from(env_names: tuple, yml_field: str, default: str) -> str:
    """ENV -> config.yml -> дефолт. Первый непустой источник побеждает."""
    for name in env_names:
        value = (os.getenv(name) or "").strip()
        if value:
            return value.upper()
    value = str(getattr(_settings_logging(), yml_field, "") or "").strip()
    return (value or default).upper()

def _level_name() -> str:
    """Уровень наших логгеров: APP_LOG_LEVEL / SVC_RAG_LOG_LEVEL / RAG_LOG_LEVEL,
    затем 'logging.level' из config.yml, затем INFO."""
    return _level_from(
        ("APP_LOG_LEVEL", "SVC_RAG_LOG_LEVEL", "RAG_LOG_LEVEL"), "level", "INFO"
    )

def _noisy_level_name() -> str:
    """Уровень чужих болтливых логгеров: RAG_LOG_NOISY_LEVEL, затем
    'logging.noisy_level' из config.yml, затем WARNING."""
    return _level_from(("RAG_LOG_NOISY_LEVEL",), "noisy_level", "WARNING")

def _resolve_level() -> int:
    return LEVEL_BY_NAME.get(_level_name(), DEFAULT_LEVEL)

def get_uvicorn_log_config() -> dict:
    """
    dictConfig для единого формата логов.
    Тот же по смыслу конфиг, что backend отдаёт в uvicorn.run(log_config=...),
    но в RAG применяется через logging.config.dictConfig(...) при импорте main.py
    Покрывает: uvicorn / uvicorn.error / uvicorn.access (свои хендлеры),
    "app" (наши логгеры) и root (httpx и всё прочее, что пропагейтит в корень)
    """
    level_name = _level_name()
    noisy_level = _noisy_level_name()
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "svc_rag": {
                "format": LOG_FORMAT,
                "datefmt": LOG_DATEFMT,
            },
        },
        "handlers": {
            "svc_rag_stdout": {
                "class": "logging.StreamHandler",
                "formatter": "svc_rag",
                "stream": "ext://sys.stdout",
            },
        },
        "loggers": {
            "uvicorn": {
                "handlers": ["svc_rag_stdout"],
                "level": level_name,
                "propagate": False,
            },
            "uvicorn.error": {
                "handlers": ["svc_rag_stdout"],
                "level": level_name,
                "propagate": False,
            },
            "uvicorn.access": {
                "handlers": ["svc_rag_stdout"],
                "level": level_name,
                "propagate": False,
            },
            APP_LOGGER_NAME: {
                "handlers": ["svc_rag_stdout"],
                "level": level_name,
                "propagate": False,
            },
            **{
                name: {"level": noisy_level, "propagate": True}
                for name in _NOISY_LOGGERS
            },
        },
        "root": {"handlers": ["svc_rag_stdout"], "level": level_name},
    }

def _ensure_stdout_utf8() -> None:
    """stdout → UTF-8, чтобы кириллица и символы [LLM→]/[LLM✗] не падали с UnicodeEncodeError"""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8")
            except Exception:
                pass

def configure_logging(*, force: bool = False) -> None:
    """
    Инициализирует логирование SVC-RAG в едином формате.
    Идемпотентно: повторные вызовы (в т.ч. ленивые из get_logger) — no-op, пока не force.
    """
    global _configured
    if _configured and not force:
        return
    _ensure_stdout_utf8()
    logging.config.dictConfig(get_uvicorn_log_config())
    _configured = True

def get_logger(name: Optional[str] = None) -> logging.Logger:
    """
    Возвращает логгер в иерархии app.*.
    Использование: logger = get_logger(__name__)
    """
    if not _configured:
        configure_logging()
    if not name:
        return logging.getLogger(APP_LOGGER_NAME)
    normalized = name.strip()
    if normalized in ("App", "app"):
        normalized = APP_LOGGER_NAME
    elif not normalized.startswith(f"{APP_LOGGER_NAME}."):
        normalized = f"{APP_LOGGER_NAME}.{normalized.lstrip('.')}"
    return logging.getLogger(normalized)

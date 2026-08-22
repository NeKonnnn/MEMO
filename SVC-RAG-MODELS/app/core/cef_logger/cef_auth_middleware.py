"""Проверка API-ключа и CEF SEC001/SEC003 для SVC-RAG-MODELS."""

from __future__ import annotations

import os
from typing import Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.cef_logger.cef_audit_context import caller_service_from_headers, user_from_request_headers
from app.core.cef_logger.cef_logger import api_key_audit_cef_extra, log_cef_event

_SKIP_PATH_SUFFIXES = (
    "/health",
    "/docs",
    "/redoc",
    "/openapi.json",
)


def _should_skip(path: str) -> bool:
    p = (path or "").rstrip("/")
    return any(p.endswith(s.rstrip("/")) or p == s.rstrip("/") for s in _SKIP_PATH_SUFFIXES)


def _configured_api_key() -> str:
    direct = (os.getenv("RAG_MODELS_API_KEY") or "").strip()
    if direct:
        return direct
    env_name = (os.getenv("RAG_MODELS_API_KEY_ENV") or "").strip()
    if env_name:
        return (os.getenv(env_name) or "").strip()
    return ""


def _extract_api_key(request: Request) -> str:
    auth = (request.headers.get("authorization") or request.headers.get("Authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return (request.headers.get("x-api-key") or request.headers.get("X-API-Key") or "").strip()


class CefAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        expected = _configured_api_key()
        if not expected or _should_skip(request.url.path):
            return await call_next(request)

        user = user_from_request_headers(request)
        caller = caller_service_from_headers(request) or "unknown"
        presented = _extract_api_key(request)

        if not presented or presented != expected:
            reason = "missing API key" if not presented else "invalid API key"
            log_cef_event(
                "SEC003",
                request=request,
                current_user=user or {"username": caller},
                status_code=401,
                extra={
                    "reason": reason,
                    "auth_method": "api_key",
                    **api_key_audit_cef_extra(caller),
                },
            )
            return JSONResponse(
                status_code=401,
                content={"detail": "Unauthorized"},
            )

        log_cef_event(
            "SEC001",
            request=request,
            current_user=user or {"username": caller, "auth_method": "api_key"},
            status_code=200,
            extra={"auth_method": "api_key", **api_key_audit_cef_extra(caller)},
        )
        return await call_next(request)

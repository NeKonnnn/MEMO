# Клиент к SVC-RAG-MODELS (и OpenAI-совместимым шлюзам) по HTTP.
# Контракт: POST /v1/embeddings (+ legacy /v1/embed), POST /v1/rerank, GET /v1/models|/v1/health.
import logging
import os
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.core.config import get_settings
from app.core.http_verify import resolve_httpx_verify

logger = logging.getLogger(__name__)


class RagModelsClient:
    """Вызовы эмбеддинга и реранкера в SVC-RAG-MODELS (HTTP, без локальной загрузки весов)."""

    _last_ensured_dim: Optional[int] = None

    def __init__(self, base_url: Optional[str] = None, timeout: Optional[float] = None):
        cfg = get_settings().rag_models_client
        self.base_url = (base_url or cfg.base_url).rstrip("/")
        self.timeout = timeout if timeout is not None else cfg.timeout
        self.embed_batch_size = max(1, int(getattr(cfg, "embed_batch_size", 24) or 24))
        self.embed_concurrency = max(1, int(getattr(cfg, "embed_concurrency", 4) or 4))
        self.api_key_env = str(getattr(cfg, "api_key_env", "") or "").strip()
        self.embedding_model = str(getattr(cfg, "embedding_model", "") or "").strip() or None
        self.reranker_model = str(getattr(cfg, "reranker_model", "") or "").strip() or None
        logger.info(
            "[rag-models] клиент: base_url=%s api_key_env=%s batch=%s concurrency=%s",
            self.base_url,
            self.api_key_env or "(не задан)",
            self.embed_batch_size,
            self.embed_concurrency,
        )

    def _api_key(self) -> str:
        if not self.api_key_env:
            return ""
        return str(os.getenv(self.api_key_env, "") or "").strip()

    def _headers(self) -> Dict[str, str]:
        headers: Dict[str, str] = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        api_key = self._api_key()
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
            headers["X-API-Key"] = api_key
        return headers

    def _client(self, timeout: Optional[float] = None) -> httpx.AsyncClient:
        t = float(timeout if timeout is not None else self.timeout)
        return httpx.AsyncClient(
            timeout=httpx.Timeout(t, connect=10.0, read=t, write=10.0),
            verify=resolve_httpx_verify(),
        )

    def _log_http_error(self, what: str, err: Exception) -> None:
        if isinstance(err, httpx.HTTPStatusError):
            body = (err.response.text or "")[:500]
            logger.error(
                "[rag-models] %s: HTTP %s url=%s тело=%s (api_key_env=%s, ключ_задан=%s). "
                "404 на /v1/embeddings → на шлюзе нет embedding-роута/модели; "
                "401/403 → проверьте API-ключ.",
                what,
                err.response.status_code,
                err.request.url,
                body,
                self.api_key_env,
                bool(self._api_key()),
            )
            return
        logger.error(
            "[rag-models] %s: %s: %s (base_url=%s)",
            what,
            type(err).__name__,
            err,
            self.base_url,
        )

    async def _ensure_db_dim(self, dim: int, *, allow_migrate: bool = True) -> None:
        """Привести pgvector к размерности модели — ТОЛЬКО для кластерной модели.

        allow_migrate=False (когда модель названа явно) миграцию НЕ запускает:
        migrate_vector_tables делает TRUNCATE всех таблиц векторов, то есть стёр бы
        корпус всех пользователей из-за одного запроса чужой моделью.
        """
        if dim < 1:
            return
        if RagModelsClient._last_ensured_dim == dim:
            return
        if not allow_migrate:
            logger.warning(
                "embed: получен вектор dim=%s при явно указанной модели — "
                "миграцию схемы НЕ запускаем (защита от TRUNCATE чужих векторов)",
                dim,
            )
            return
        from app.dependencies import ensure_embedding_dim

        await ensure_embedding_dim(dim)
        RagModelsClient._last_ensured_dim = dim

    @staticmethod
    def _parse_embeddings(data: Dict[str, Any], expected: int) -> List[List[float]]:
        """Разбор ответа /v1/embeddings или legacy /v1/embed."""
        # OpenAI: {"data":[{"embedding":[...],"index":0}, ...]}
        items = data.get("data")
        if isinstance(items, list) and items:
            if len(items) != expected:
                raise ValueError(
                    f"Число эмбеддингов ({len(items)}) не совпадает с размером батча ({expected})"
                )
            ordered = sorted(items, key=lambda it: int(it.get("index") or 0))
            return [list(it.get("embedding") or []) for it in ordered]

        # Legacy native: {"embeddings":[[...], ...]}
        part = data.get("embeddings") or []
        if len(part) != expected:
            raise ValueError(
                f"Число эмбеддингов ({len(part)}) не совпадает с размером батча ({expected})"
            )
        return [list(v or []) for v in part]

    async def embed(
        self,
        texts: List[str],
        model: Optional[str] = None,
        kind: Optional[str] = None,
    ) -> List[List[float]]:
        """Эмбеддинги: POST {base}/v1/embeddings {"input", optional model/kind}.

        model=None допустим для native SVC-RAG-MODELS — сервис возьмёт кластерный дефолт.
        Батчи идут параллельно (embed_concurrency /
        RAG_MODELS_CLIENT_EMBED_CONCURRENCY).
        """
        if not texts:
            return []
        use_model = (model or self.embedding_model or "").strip()
        url = f"{self.base_url}/v1/embeddings"
        from app.clients.embed_parallel import embed_texts_in_batches

        async with self._client() as client:

            async def _one_batch(start: int, batch: List[str]) -> List[List[float]]:
                payload: Dict[str, Any] = {"input": batch}
                if use_model:
                    payload["model"] = use_model
                if kind:
                    payload["kind"] = kind
                try:
                    resp = await client.post(url, headers=self._headers(), json=payload)
                    resp.raise_for_status()
                    part = self._parse_embeddings(resp.json(), len(batch))
                except Exception as e:
                    self._log_http_error("POST /v1/embeddings", e)
                    raise
                if part and part[0]:
                    await self._ensure_db_dim(
                        len(part[0]), allow_migrate=model is None
                    )
                return part

            return await embed_texts_in_batches(
                texts,
                batch_size=self.embed_batch_size,
                concurrency=self.embed_concurrency,
                embed_batch=_one_batch,
                log_prefix="RAG-MODELS embed",
            )

    async def embed_single(
        self,
        text: str,
        model: Optional[str] = None,
        kind: Optional[str] = None,
    ) -> List[float]:
        """Один текст — один вектор."""
        vectors = await self.embed([text], model=model, kind=kind)
        return vectors[0] if vectors else []

    async def rerank(
        self,
        query: str,
        passages: List[str],
        top_k: int = 20,
        model: Optional[str] = None,
    ) -> List[Tuple[int, float]]:
        """Реранк: POST /v1/rerank (documents + top_n, плюс legacy indices/scores)."""
        if not passages:
            return []
        use_model = (model or self.reranker_model or "").strip()
        url = f"{self.base_url}/v1/rerank"
        payload: Dict[str, Any] = {
            "query": query,
            "documents": passages,
            "top_n": min(int(top_k), len(passages)),
        }
        if use_model:
            payload["model"] = use_model
        try:
            async with self._client() as client:
                resp = await client.post(url, headers=self._headers(), json=payload)
                resp.raise_for_status()
                data = resp.json()
        except Exception as e:
            self._log_http_error("POST /v1/rerank", e)
            raise

        results = data.get("results")
        if isinstance(results, list) and results:
            pairs: List[Tuple[int, float]] = []
            for item in results:
                if not isinstance(item, dict) or item.get("index") is None:
                    continue
                pairs.append(
                    (int(item["index"]), float(item.get("relevance_score") or 0.0))
                )
            return pairs

        indices = data.get("indices") or []
        scores = data.get("scores") or []
        return list(zip(indices, scores))

    async def health(self) -> bool:
        """Проверка доступности: /v1/models, иначе legacy /v1/health."""
        try:
            async with self._client(timeout=5.0) as client:
                r = await client.get(
                    f"{self.base_url}/v1/models", headers=self._headers()
                )
                if r.status_code == 200:
                    return True
                r2 = await client.get(
                    f"{self.base_url}/v1/health", headers=self._headers()
                )
                return r2.status_code == 200
        except Exception as e:
            logger.warning("RAG-MODELS health check failed: %s", e)
            return False

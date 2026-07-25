"""Роутинг embedding-модели: (provider, model) -> клиент, размерность, таблица.

Зачем этот модуль. У каждой размерности своя таблица векторов, а модель
у каждого пользователя своя. Значит на КАЖДУЮ операцию индексации/поиска надо знать
три вещи:

* каким клиентом считать — нативным svc-rag-models или внешним OpenAI-совместимым;
* какое имя модели передать этому клиенту;
* какая размерность у результата — от неё зависит таблица векторов.

Размерность НЕ берётся из конфига и не хардкодится: её даёт сам вектор. Для новой
пары (provider, model) делается один пробный embed, дальше работает кэш процесса.
Так гард по dim не зависит от того, объявляет ли модель размерность в дескрипторе.

Обратная совместимость: если ни provider, ни model не заданы (кластерный путь),
возвращается ТОТ ЖЕ клиент и ТА ЖЕ таблица
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

NATIVE = "native"

# Кэши процесса. Ключ модели — (provider, model), где provider="" означает
# «кластерный клиент по умолчанию» (тот, что уже лежит в сервисе).
_clients: Dict[Tuple[str, str], Any] = {}
_dims: Dict[Tuple[str, str], int] = {}
_dim_locks: Dict[Tuple[str, str], asyncio.Lock] = {}
_repos: Dict[Tuple[str, int], Any] = {}
_repo_lock = asyncio.Lock()

_PROBE_TEXT = "проверка размерности"

def _norm(provider: Optional[str], model: Optional[str]) -> Tuple[str, Optional[str]]:
    p = (provider or "").strip()
    m = (model or "").strip() or None
    return p, m

def _key(provider: str, model: Optional[str]) -> Tuple[str, str]:
    return (provider or "", model or "")

@dataclass(frozen=True)
class EmbedProfile:
    """Чем и во что считать эмбеддинги для одной операции.

    provider: "" — кластерный клиент сервиса, "native" — svc-rag-models,
              иначе id провайдера из rag_models.providers (PHOENIX и т.п.).
    model:    имя модели для этого клиента (None — модель по умолчанию).
    dim:      размерность векторов; по ней выбирается таблица.
    """

    provider: str
    model: Optional[str]
    dim: int
    client: Any

    @property
    def label(self) -> str:
        return f"{self.provider or 'cluster'}/{self.model or 'default'}(dim={self.dim})"

    async def embed(
        self, texts: List[str], kind: Optional[str] = None
    ) -> List[List[float]]:
        """Посчитать эмбеддинги этим профилем.

        kind="document" для чанков, "query" для запроса — включает префиксы
        асимметричных моделей (FRIDA), см. фазу B1.
        """
        vectors = await self.client.embed(texts, model=self.model, kind=kind)
        if vectors and vectors[0]:
            got = len(vectors[0])
            if self.dim and got != self.dim:
                # Записать их в выбранную таблицу нельзя — размерность колонки другая.
                # Кэш чиним, чтобы повтор ушёл в правильную таблицу, и падаем громко.
                _dims[_key(self.provider, self.model)] = got
                raise RuntimeError(
                    f"[EMBED-ROUTE] {self.label}: модель вернула dim={got}. "
                    "Профиль пересчитан — повторите операцию."
                )
            note_dim(self.provider, self.model, got)
        return vectors

def note_dim(provider: Optional[str], model: Optional[str], dim: int) -> None:
    """Запомнить фактическую размерность пары (provider, model)."""
    p, m = _norm(provider, model)
    d = int(dim or 0)
    if d < 1:
        return
    key = _key(p, m)
    if _dims.get(key) != d:
        _dims[key] = d
        logger.info("[EMBED-ROUTE] provider=%s model=%s dim=%s", p or "cluster", m, d)

def _provider_entry(provider_id: str):
    from app.core.config import get_settings

    for entry in getattr(get_settings().rag_models, "providers", None) or []:
        if entry.id == provider_id:
            return entry
    return None

def _client_for(provider: str, model: Optional[str], default_client: Any) -> Any:
    """Клиент эмбеддинга для провайдера. Кэшируется — httpx-клиент внутри дешёвый."""
    if not provider or provider.lower() == NATIVE:
        # native: имя модели едет в теле запроса (фаза B1), хватает одного клиента.
        from app.clients.rag_models_client import RagModelsClient

        key = _key(NATIVE, None)
        client = _clients.get(key)
        if client is None:
            client = RagModelsClient()
            _clients[key] = client
        return client

    key = _key(provider, model)
    client = _clients.get(key)
    if client is not None:
        return client

    entry = _provider_entry(provider)
    if entry is None:
        logger.error(
            "[EMBED-ROUTE] провайдер '%s' не найден в rag_models.providers — "
            "работаем клиентом по умолчанию",
            provider,
        )
        return default_client

    from app.clients.openai_models_compat_client import OpenAICompatModelsClient
    from app.core.config import get_settings

    client = OpenAICompatModelsClient(
        provider_id=entry.id,
        base_url=entry.base_url,
        api_key_env=entry.api_key_env or None,
        embedding_model=model or entry.embedding_model or None,
        reranker_model=entry.reranker_model or None,
        timeout=entry.timeout,
        embed_batch_size=get_settings().rag_models_client.embed_batch_size,
    )
    _clients[key] = client
    logger.info(
        "[EMBED-ROUTE] клиент создан: provider=%s model=%s base_url=%s",
        provider,
        model,
        entry.base_url,
    )
    return client

async def resolve_dim(client: Any, provider: str, model: Optional[str]) -> int:
    """Размерность пары (provider, model). Первый раз — пробный embed, дальше кэш."""
    key = _key(provider or NATIVE, model)
    dim = _dims.get(key)
    if dim:
        return dim

    lock = _dim_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _dim_locks[key] = lock

    async with lock:
        dim = _dims.get(key)
        if dim:
            return dim
        vectors = await client.embed([_PROBE_TEXT], model=model, kind="query")
        dim = len(vectors[0]) if vectors and vectors[0] else 0
        if dim < 1:
            raise RuntimeError(
                f"[EMBED-ROUTE] provider={provider or NATIVE} model={model}: "
                "пробный embed вернул пустой вектор — размерность неизвестна"
            )
        _dims[key] = dim
        logger.info(
            "[EMBED-ROUTE] проба: provider=%s model=%s dim=%s",
            provider or NATIVE,
            model,
            dim,
        )
        return dim

async def resolve_profile(
    default_client: Any,
    provider: Optional[str] = None,
    model: Optional[str] = None,
) -> EmbedProfile:
    """Профиль эмбеддинга для операции.

    Без provider и model — кластерный путь: тот же клиент и та же размерность,
    что были до фазы B3 (никакой пробы, никаких новых таблиц).
    """
    p, m = _norm(provider, model)
    if not p and not m:
        from app.core.config import get_settings

        return EmbedProfile(
            provider="",
            model=None,
            dim=int(get_settings().postgresql.embedding_dim or 0),
            client=default_client,
        )
    client = _client_for(p, m, default_client)
    dim = await resolve_dim(client, p, m)
    return EmbedProfile(provider=p or NATIVE, model=m, dim=dim, client=client)

async def vector_repo_for(root_repo: Any, dim: int) -> Any:
    """Репозиторий, адресующий таблицу этой размерности (фаза B2b).

    Экземпляры кэшируются по (класс репозитория, dim). При первом обращении
    create_tables добавляет таблицу нужной размерности — операция добавляющая,
    существующие данные не трогает.
    """
    d = int(dim or 0)
    root_dim = int(getattr(root_repo, "embedding_dim", 0) or 0)
    if d < 1 or d == root_dim:
        return root_repo

    key = (type(root_repo).__name__, d)
    repo = _repos.get(key)
    if repo is not None:
        return repo

    async with _repo_lock:
        repo = _repos.get(key)
        if repo is not None:
            return repo
        repo = type(root_repo)(root_repo.db, embedding_dim=d)
        await repo.create_tables()
        _repos[key] = repo
        logger.info(
            "[EMBED-ROUTE] репозиторий %s для dim=%s готов", type(root_repo).__name__, d
        )
        return repo

async def resolve_for(
    default_client: Any,
    root_repo: Any,
    provider: Optional[str] = None,
    model: Optional[str] = None,
) -> Tuple[EmbedProfile, Any]:
    """Одной строкой: профиль эмбеддинга + репозиторий нужной таблицы."""
    profile = await resolve_profile(default_client, provider, model)
    repo = await vector_repo_for(root_repo, profile.dim)
    return profile, repo


# Клиенты реранка. Отдельный кэш от эмбеддинга: у провайдера это разные модели,
# и пользователь волен взять эмбеддер у одного, а реранкер у другого.
_rerank_clients: Dict[Tuple[str, str], Any] = {}

def rerank_client_for(
    default_client: Any,
    provider: Optional[str] = None,
    model: Optional[str] = None,
) -> Any:
    """Клиент реранка для пары (provider, model).

    Хранилища у реранка нет, поэтому здесь только выбор клиента — ни размерности,
    ни таблицы, ни пробного вызова. Имя модели передаётся в сам вызов rerank(),
    так что одного клиента на провайдера достаточно.

    Без provider — кластерный клиент, как было до фазы E.
    """
    p, m = _norm(provider, model)
    if not p:
        return default_client
    if p.lower() == NATIVE:
        from app.clients.rag_models_client import RagModelsClient

        key = _key(NATIVE, None)
        client = _clients.get(key)
        if client is None:
            client = RagModelsClient()
            _clients[key] = client
        return client

    key = _key(p, m)
    client = _rerank_clients.get(key)
    if client is not None:
        return client
    entry = _provider_entry(p)
    if entry is None:
        logger.error(
            "[RERANK-ROUTE] провайдер '%s' не найден в rag_models.providers — "
            "реранк клиентом по умолчанию",
            p,
        )
        return default_client

    from app.clients.openai_models_compat_client import OpenAICompatModelsClient
    from app.core.config import get_settings

    client = OpenAICompatModelsClient(
        provider_id=entry.id,
        base_url=entry.base_url,
        api_key_env=entry.api_key_env or None,
        reranker_model=m or entry.reranker_model or None,
        timeout=entry.timeout,
        embed_batch_size=get_settings().rag_models_client.embed_batch_size,
    )
    _rerank_clients[key] = client
    logger.info("[RERANK-ROUTE] клиент создан: provider=%s model=%s", p, m)
    return client


def routing_overview() -> Dict[str, Any]:
    """Диагностика для /v1/health: что процесс уже знает о моделях."""
    return {
        "models": [
            {"provider": p or "cluster", "model": m or None, "dim": d}
            for (p, m), d in sorted(_dims.items())
        ],
        "clients": [f"{p or 'cluster'}/{m or 'default'}" for (p, m) in _clients],
        "rerank_clients": [
            f"{p or 'cluster'}/{m or 'default'}" for (p, m) in _rerank_clients
        ],
        "repos": [{"repo": name, "dim": d} for (name, d) in sorted(_repos)],
    }
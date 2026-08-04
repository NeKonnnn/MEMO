"""СПЯЩАЯ диагностика — где на шлюзе живут эмбеддинги.

Сейчас НЕ ВЫЗЫВАЕТСЯ ниоткуда: из ```app/main.py``` вызов убран после того, как
маршруты выяснили (31.07). Файл оставлен намеренно — он ещё пригодится, когда
платформа в очередной раз поменяет шлюз, и переписывать его заново будет жаль.
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.core.http_verify import resolve_httpx_verify
from app.core.logging import get_logger

logger = get_logger(__name__)

# Выключатель. Переменной окружения может не быть (ConfigMap правится не нами),
# поэтому основной рычаг — эта константа: правится тем же пушем кода.
PROBE_ENABLED = True

# Задержка перед стартом: даём приложению доподняться, чтобы диагностика не
# мешалась в логе с сообщениями о старте БД.
PROBE_DELAY_SECONDS = 5.0

# Кандидаты маршрута эмбеддингов. /v1/* — собственные маршруты Bifrost,
# /openai/v1/* — drop-in совместимость под префиксом провайдера (её мы ещё
# не пробовали), остальное — на случай нестандартного префикса шлюза.
EMBED_PATHS: Tuple[str, ...] = (
    "/v1/embeddings",
    "/openai/v1/embeddings",
    "/api/v1/embeddings",
    "/embeddings",
    "/v1/embed",
)

# Управляющее API Bifrost: скажет, какой провайдер стоит за embed/FRIDA
# и опубликованы ли у него эмбеддинги.
ADMIN_PATHS: Tuple[str, ...] = ("/api/providers", "/api/config")

# Запасные имена моделей, если каталог не отдался.
FALLBACK_MODELS: Tuple[str, ...] = ("embed/FRIDA", "FRIDA")

# Дополнительные адреса, которых нет в rag_models.providers.
# Зачем: снаружи llm.corsur отвечает 404 в формате APISIX, то есть запрос до
# Bifrost может не доходить вовсе. Если вписать сюда внутрикластерный адрес
# самого Bifrost, проверка пойдёт мимо ingress — и станет видно, работает ли
# маршрут в самом шлюзе. Формат: "http://host:port" или "http://host:port|ENV_С_КЛЮЧОМ".
# Ключ по умолчанию — LLM_API_KEY. Можно задать и через переменную
# RAG_EMBED_PROBE_EXTRA_URLS (через запятую), если правка кода не нужна.
EXTRA_BASE_URLS: Tuple[str, ...] = ()

_BODY_LIMIT = 400
_TIMEOUT = 20.0

def _headers(api_key: str) -> Dict[str, str]:
    """Те же заголовки, что шлёт боевой клиент (openai_models_compat_client:52)."""
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
        headers["X-API-Key"] = api_key
    return headers

def _short(text: Optional[str]) -> str:
    return (text or "").replace("\n", " ")[:_BODY_LIMIT]

def _route_missing(resp: httpx.Response) -> bool:
    """404 именно от маршрутизатора, а не от модели.

    Отличать важно: 404 маршрута означает, что перебирать имена моделей на
    этом пути бессмысленно, а 404 модели — наоборот, что путь верный.
    """
    if resp.status_code != 404:
        return False
    body = (resp.text or "").lower()
    return "route not found" in body or "404 page not found" in body

# Полный каталог по адресу — нужен, чтобы взять контрольную чат-модель.
_catalog_by_url: Dict[str, List[str]] = {}

async def _probe_catalog(
    client: httpx.AsyncClient, base_url: str, headers: Dict[str, str]
) -> List[str]:
    """GET /v1/models. Возвращает id, похожие на embedding-модели."""
    url = f"{base_url}/v1/models"
    try:
        resp = await client.get(url, headers=headers)
    except Exception as e:
        logger.warning("[EMBED-PROBE]   GET /v1/models -> ОШИБКА %s: %s", type(e).__name__, e)
        return []

    logger.info("[EMBED-PROBE]   GET /v1/models -> HTTP %s", resp.status_code)
    if resp.status_code != 200:
        logger.info("[EMBED-PROBE]     тело: %s", _short(resp.text))
        return []

    try:
        items = (resp.json() or {}).get("data") or []
    except Exception:
        logger.warning("[EMBED-PROBE]     тело не JSON: %s", _short(resp.text))
        return []

    ids: List[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        model_id = str(item.get("id") or "").strip()
        if not model_id:
            continue
        ids.append(model_id)
        # Печатаем запись целиком: у Bifrost там бывает поле с типом модели,
        # и это ровно то, что нужно знать про embed/FRIDA.
        logger.info("[EMBED-PROBE]     модель: %s", json.dumps(item, ensure_ascii=False)[:300])

    embed_like = [m for m in ids if "embed" in m.lower() or "frida" in m.lower()]
    logger.info("[EMBED-PROBE]   всего моделей: %s, похожих на embedding: %s", len(ids), embed_like)
    _catalog_by_url[base_url] = ids
    return embed_like

async def _probe_admin(
    client: httpx.AsyncClient, base_url: str, headers: Dict[str, str]
) -> None:
    """Управляющее API шлюза. 401/403 здесь — норма, ключ не админский."""
    for path in ADMIN_PATHS:
        try:
            resp = await client.get(f"{base_url}{path}", headers=headers)
        except Exception as e:
            logger.info("[EMBED-PROBE]   GET %s -> ОШИБКА %s: %s", path, type(e).__name__, e)
            continue
        logger.info(
            "[EMBED-PROBE]   GET %s -> HTTP %s: %s", path, resp.status_code, _short(resp.text)
        )

async def _probe_embed_paths(
    client: httpx.AsyncClient,
    base_url: str,
    headers: Dict[str, str],
    models: List[str],
) -> List[str]:
    """Матрица путь x модель. Возвращает строки для итоговой сводки."""
    summary: List[str] = []
    for path in EMBED_PATHS:
        for model in models:
            payload = {"model": model, "input": ["ping"]}
            try:
                resp = await client.post(f"{base_url}{path}", headers=headers, json=payload)
            except Exception as e:
                line = f"POST {path} model={model} -> ОШИБКА {type(e).__name__}: {e}"
                logger.info("[EMBED-PROBE]   %s", line)
                summary.append(line)
                break  # сеть/TLS — перебирать модели смысла нет

            line = f"POST {path} model={model} -> HTTP {resp.status_code}"

            if resp.status_code == 200:
                # Тело не печатаем: это тысячи чисел, в лог полезен только dim.
                dim = _extract_dim(resp)
                line = f"{line} УСПЕХ, dim={dim}"
                logger.info("[EMBED-PROBE]   %s", line)
                summary.append(line)
                return summary  # нашли рабочий маршрут, дальше не нужно

            body = _short(resp.text)
            logger.info("[EMBED-PROBE]   %s: %s", line, body)

            summary.append(f"{line}: {body[:120]}")
            if _route_missing(resp):
                # Маршрута нет вообще — имя модели ни при чём.
                break
    return summary

def _find_vector(value: Any, depth: int = 0) -> int:
    """Длина первого попавшегося списка чисел. 0 — вектора в ответе нет.

    Ищем рекурсивно, а не по известным ключам: через прокси ответ может
    прийти завёрнутым во что угодно, и заранее мы формат не знаем.
    """
    if depth > 6:
        return 0
    if isinstance(value, list):
        if len(value) >= 8 and all(isinstance(x, (int, float)) for x in value[:8]):
            return len(value)
        for item in value[:3]:
            found = _find_vector(item, depth + 1)
            if found:
                return found
        return 0
    if isinstance(value, dict):
        for item in value.values():
            found = _find_vector(item, depth + 1)
            if found:
                return found
    return 0

def _shape(value: Any, depth: int = 0) -> Any:
    """Структура ответа без самих данных: ключи, типы, длины.

    Печатать тело целиком нельзя — там тысячи чисел. А чтобы написать парсер,
    нужно знать ровно это: какие ключи и что в них лежит.
    """
    if depth > 5:
        return "..."
    if isinstance(value, dict):
        return {k: _shape(v, depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        if not value:
            return "список[0]"
        if len(value) >= 8 and all(isinstance(x, (int, float)) for x in value[:8]):
            return f"ВЕКТОР[{len(value)}]"
        return [f"список[{len(value)}]", _shape(value[0], depth + 1)]
    if isinstance(value, str):
        return f"строка({len(value)})"
    return type(value).__name__

def _extract_dim(resp: httpx.Response) -> int:
    """Размерность из ответа. Понимает и OpenAI-формат, и наш нативный, и любой другой."""
    try:
        data = resp.json() or {}
    except Exception:
        return 0
    items = data.get("data")
    if isinstance(items, list) and items and isinstance(items[0], dict):
        dim = len(items[0].get("embedding") or [])
        if dim:
            return dim
    vectors = data.get("embeddings")
    if isinstance(vectors, list) and vectors and isinstance(vectors[0], list):
        return len(vectors[0])
    return _find_vector(data)

async def _probe_native_body(
    client: httpx.AsyncClient,
    base_url: str,
    headers: Dict[str, str],
    model: str,
) -> str:
    """POST /v1/embed телом НАШЕГО формата: {"texts": [...]} вместо {"input": ...}.

    Нужно, чтобы отличить «маршрута нет» от «маршрут есть, но ждёт другое тело».
    Если на шлюзе сделали проброс на /v1/embed, а он вернул 400/422 на
    OpenAI-тело — ответ увидим здесь, и станет ясно, что нужна не правка
    конфига, а поддержка второго формата в клиенте.
    """
    url = f"{base_url}/v1/embed"
    payload: Dict[str, Any] = {"texts": ["ping"], "model": model, "kind": "query"}
    try:
        resp = await client.post(url, headers=headers, json=payload)
    except Exception as e:
        line = f"нативное тело /v1/embed -> ОШИБКА {type(e).__name__}: {e}"
        logger.info("[EMBED-PROBE]   %s", line)
        return line
    if resp.status_code == 200:
        line = f"нативное тело /v1/embed -> HTTP 200 УСПЕХ, dim={_extract_dim(resp)}"
        logger.info("[EMBED-PROBE]   %s", line)
        return line
    line = f"нативное тело /v1/embed -> HTTP {resp.status_code}"
    logger.info("[EMBED-PROBE]   %s: %s", line, _short(resp.text))
    return f"{line}: {_short(resp.text)[:120]}"

async def _chat_call(
    client: httpx.AsyncClient,
    base_url: str,
    headers: Dict[str, str],
    payload: Dict[str, Any],
    *,
    passthrough: bool,
    label: str,
) -> str:
    """Один вызов /v1/chat/completions. Тело печатаем всегда — оно тут и есть ответ."""
    hp = dict(headers)
    if passthrough:
        hp["x-bf-passthrough-extra-params"] = "true"
    try:
        resp = await client.post(
            f"{base_url}/v1/chat/completions", headers=hp, json=payload
        )
    except Exception as e:
        line = f"{label} -> ОШИБКА {type(e).__name__}: {e}"
        logger.info("[EMBED-PROBE]   %s", line)
        return line
    body = _short(resp.text)
    dim = _extract_dim(resp) if resp.status_code == 200 else 0
    verdict = f" ВЕКТОР dim={dim}" if dim else ""
    logger.info("[EMBED-PROBE]   %s -> HTTP %s%s: %s", label, resp.status_code, verdict, body)
    if resp.status_code == 200:
        # Структура ответа — то, из чего пишется парсер. Тело целиком не печатаем.
        try:
            logger.info(
                "[EMBED-PROBE]     СТРУКТУРА: %s",
                json.dumps(_shape(resp.json()), ensure_ascii=False)[:1200],
            )
        except Exception:
            logger.info("[EMBED-PROBE]     тело не JSON")
    return f"{label} -> HTTP {resp.status_code}{verdict}: {body[:120]}"

async def _probe_passthrough(
    client: httpx.AsyncClient,
    base_url: str,
    headers: Dict[str, str],
    model: str,
) -> List[str]:
    """Можно ли получить эмбеддинги через единственный живой POST-маршрут.

    Матрица, а не один вызов: без контрольных случаев результат не читается.

    1. чат-модель обычным телом — контроль: работает ли /v1/chat/completions
       вообще с нашим ключом и заголовками из этого пода. Если тут не 200,
       все остальные 404 объясняются доступом, а не маршрутизацией;
    2. embedding-модель без passthrough — что шлюз отвечает на «голый» вызов;
    3. embedding-модель с passthrough и полем input — попытка тоннеля;
    4. embedding-модель с passthrough и полем texts — то же нашим форматом;
    5. rerank-модель как в скрипте коллег — контроль: работает ли ИХ тоннель.
       Если 200 здесь и 404 в п.3 — значит дело в конкретном провайдере
       внутри Bifrost, а не в самой идее passthrough.

    Оговорка: даже 200 сам по себе ничего не даёт. Chat-completions возвращает
    текст, а не вектор. Смысл есть только если в ответе окажется поле data/
    embeddings — это отмечено в логе как ВЕКТОР.
    """
    catalog = _catalog_by_url.get(base_url) or []
    lower = [(m, m.lower()) for m in catalog]
    chat_model = next(
        (
            m
            for m, n in lower
            if not any(h in n for h in ("embed", "frida", "rerank"))
        ),
        None,
    )
    rerank_model = next((m for m, n in lower if "rerank" in n), None)

    msgs = [{"role": "user", "content": "ping"}]
    results: List[str] = []

    if chat_model:
        results.append(
            await _chat_call(
                client,
                base_url,
                headers,
                {"model": chat_model, "messages": msgs},
                passthrough=False,
                label=f"КОНТРОЛЬ чат model={chat_model}",
            )
        )
    else:
        results.append("КОНТРОЛЬ чат: в каталоге нет чат-модели — пропуск")

    results.append(
        await _chat_call(
            client,
            base_url,
            headers,
            {"model": model, "messages": msgs},
            passthrough=False,
            label=f"тоннель без passthrough model={model}",
        )
    )
    # Дословно payload из исправленного скрипта коллег — у них он работает.
    # Отличия от нашей прошлой попытки: input СПИСКОМ, а не строкой, плюс поля
    # нативного контракта svc-rag-models (text/texts/kind). Bifrost стоит
    # прокси перед svc-rag-models, поэтому тело должно совпадать с тем, что
    # ждёт наш же сервис, а не с OpenAI-форматом.
    results.append(
        await _chat_call(
            client,
            base_url,
            headers,
            {
                "model": model,
                "messages": [{"role": "user", "content": "Send request"}],
                "input": ["текст чанка 1", "текст чанка 2"],
                "text": "",
                "texts": [""],
                "kind": "",
            },
            passthrough=True,
            label=f"ТОННЕЛЬ КАК В СКРИПТЕ (input списком) model={model}",
        )
    )
    # Тот же вызов, но с осмысленными texts/kind: если сервис читает наш
    # нативный контракт, а не input, разница будет видна по числу векторов.
    results.append(
        await _chat_call(
            client,
            base_url,
            headers,
            {
                "model": model,
                "messages": [{"role": "user", "content": "Send request"}],
                "texts": ["текст чанка 1", "текст чанка 2"],
                "kind": "document",
            },
            passthrough=True,
            label=f"тоннель нативным контрактом (texts+kind) model={model}",
        )
    )
    results.append(
        await _chat_call(
            client,
            base_url,
            headers,
            {"model": model, "input": "ping", "messages": msgs},
            passthrough=True,
            label=f"тоннель passthrough+input строкой model={model}",
        )
    )
    results.append(
        await _chat_call(
            client,
            base_url,
            headers,
            {"model": model, "texts": ["ping"], "kind": "query", "messages": msgs},
            passthrough=True,
            label=f"тоннель passthrough+texts model={model}",
        )
    )
    if rerank_model:
        results.append(
            await _chat_call(
                client,
                base_url,
                headers,
                {
                    "model": rerank_model,
                    "query": "ping",
                    "passages": ["первый документ", "второй документ"],
                    "messages": msgs,
                    "top_k": "1",
                },
                passthrough=True,
                label=f"КОНТРОЛЬ реранк как в скрипте model={rerank_model}",
            )
        )
    return results

async def _probe_provider(provider_id: str, base_url: str, api_key_env: str) -> List[str]:
    base_url = (base_url or "").rstrip("/")
    if not base_url:
        return [f"{provider_id}: base_url пуст — пропуск"]

    api_key = str(os.getenv(api_key_env, "") or "").strip() if api_key_env else ""
    logger.info(
        "[EMBED-PROBE] === провайдер %s, base_url=%s, ключ из %s задан=%s (длина %s) ===",
        provider_id,
        base_url,
        api_key_env or "-",
        bool(api_key),
        len(api_key),
    )
    headers = _headers(api_key)
    summary: List[str] = []

    async with httpx.AsyncClient(
        timeout=httpx.Timeout(_TIMEOUT, connect=5.0),
        verify=resolve_httpx_verify(),
    ) as client:
        await _probe_admin(client, base_url, headers)
        models = await _probe_catalog(client, base_url, headers)
        candidates = models or list(FALLBACK_MODELS)
        summary.extend(await _probe_embed_paths(client, base_url, headers, candidates))
        summary.append(await _probe_native_body(client, base_url, headers, candidates[0]))
        summary.extend(
            await _probe_passthrough(client, base_url, headers, candidates[0])
        )

    return [f"{provider_id}: {line}" for line in summary]

def _extra_targets() -> List[str]:
    """Дополнительные адреса из константы и из переменной окружения."""
    raw = str(os.getenv("RAG_EMBED_PROBE_EXTRA_URLS", "") or "")
    from_env = [part.strip() for part in raw.split(",") if part.strip()]
    return [*EXTRA_BASE_URLS, *from_env]

async def run_embed_probe() -> None:
    """Обойти всех внешних провайдеров из конфига и напечатать сводку."""
    from app.core.config import get_settings

    cfg = get_settings()
    providers = list(cfg.rag_models.providers or [])
    if not providers:
        logger.info("[EMBED-PROBE] в rag_models.providers пусто — проверять нечего")
        return

    targets: List[Tuple[str, str, str]] = [
        (p.id, p.base_url, p.api_key_env) for p in providers
    ]
    for raw in _extra_targets():
        url, _, key_env = raw.partition("|")
        url = url.strip()
        if url:
            targets.append((f"ПРЯМОЙ:{url}", url, (key_env or "LLM_API_KEY").strip()))

    logger.info(
        "[EMBED-PROBE] старт. Цели: %s. Это временная диагностика, ничего не меняет.",
        [t[0] for t in targets],
    )
    summary: List[str] = []
    for target_id, base_url, api_key_env in targets:
        try:
            summary.extend(await _probe_provider(target_id, base_url, api_key_env))
        except Exception:
            logger.exception("[EMBED-PROBE] цель %s: диагностика упала", target_id)
            summary.append(f"{target_id}: диагностика упала, см. traceback выше")

    logger.info("[EMBED-PROBE] ======== ИТОГ ========")
    for line in summary:
        logger.info("[EMBED-PROBE] %s", line)
    logger.info("[EMBED-PROBE] ======== КОНЕЦ ========")

def schedule_embed_probe() -> None:
    """Поставить диагностику фоновой задачей. Старт приложения не блокирует."""
    if not PROBE_ENABLED or str(os.getenv("RAG_EMBED_PROBE", "1")).strip() == "0":
        return

    async def _runner() -> None:
        try:
            await asyncio.sleep(PROBE_DELAY_SECONDS)
            await run_embed_probe()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[EMBED-PROBE] диагностика не выполнилась")

    try:
        asyncio.get_running_loop().create_task(_runner())
    except RuntimeError:
        logger.warning("[EMBED-PROBE] нет запущенного event loop — диагностика пропущена")
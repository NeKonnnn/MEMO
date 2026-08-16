import { getApiUrl } from '../config/api';
import type { PluginInvokeResult, PluginPublic } from './types';

export const PLUGINS_API = {
  LIST: '/api/plugins',
  ITEM: (id: string) => `/api/plugins/${encodeURIComponent(id)}`,
  HEALTH: (id: string) => `/api/plugins/${encodeURIComponent(id)}/health`,
  INVOKE: (id: string) => `/api/plugins/${encodeURIComponent(id)}/invoke`,
} as const;

export type PluginsListResponse = {
  success?: boolean;
  enabled: boolean;
  plugins: PluginPublic[];
  catalog_ids?: string[];
};

function authHeaders(json = true): HeadersInit {
  const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function fetchPluginsResponse(includeHealth = false): Promise<PluginsListResponse> {
  const qs = includeHealth ? '?include_health=true' : '';
  const url = getApiUrl(`${PLUGINS_API.LIST}${qs}`);
  console.info('[plugins] GET', url, { includeHealth });
  const resp = await fetch(url, {
    headers: authHeaders(),
  });
  if (!resp.ok) {
    console.warn('[plugins] list failed', resp.status, url);
    throw new Error(`Не удалось загрузить плагины (${resp.status})`);
  }
  const data = await resp.json();
  const payload: PluginsListResponse = {
    enabled: data.enabled !== false,
    plugins: (data.plugins || []) as PluginPublic[],
    catalog_ids: Array.isArray(data.catalog_ids) ? data.catalog_ids : undefined,
    success: data.success,
  };
  console.info('[plugins] list ok', {
    enabled: payload.enabled,
    count: payload.plugins.length,
    ids: payload.plugins.map((p) => p.id),
    catalog_ids: payload.catalog_ids,
    includeHealth,
  });
  return payload;
}

export async function fetchPlugins(includeHealth = false): Promise<PluginPublic[]> {
  const data = await fetchPluginsResponse(includeHealth);
  return data.plugins;
}

export async function fetchPluginHealth(pluginId: string): Promise<{
  ok: boolean;
  error?: string;
  detail?: Record<string, unknown>;
}> {
  const url = getApiUrl(PLUGINS_API.HEALTH(pluginId));
  console.info('[plugins] health', pluginId, url);
  const resp = await fetch(url, {
    headers: authHeaders(),
  });
  if (!resp.ok) {
    console.warn('[plugins] health failed', pluginId, resp.status);
    throw new Error(`Health check failed (${resp.status})`);
  }
  const data = await resp.json();
  const health = data.health || {};
  console.info('[plugins] health result', pluginId, {
    ok: !!health.ok,
    error: health.error,
  });
  return {
    ok: !!health.ok,
    error: health.error,
    detail: health.detail,
  };
}

export async function invokePlugin(
  pluginId: string,
  opts: {
    modelFile: File;
    qualityFile?: File | null;
    prompt?: string;
  },
): Promise<PluginInvokeResult> {
  const form = new FormData();
  form.append('model_file', opts.modelFile);
  if (opts.qualityFile) form.append('quality_file', opts.qualityFile);
  if (opts.prompt?.trim()) form.append('prompt', opts.prompt.trim());

  const url = getApiUrl(PLUGINS_API.INVOKE(pluginId));
  console.info('[plugins] invoke', pluginId, {
    model: opts.modelFile.name,
    quality: opts.qualityFile?.name,
    hasPrompt: Boolean(opts.prompt?.trim()),
  });
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: authHeaders(false),
      body: form,
    });
  } catch (e: unknown) {
    // Оборванное соединение (таймаут прокси, перезапуск пода) — fetch падает без ответа.
    const cause = e instanceof Error && e.message ? e.message : String(e);
    console.warn('[plugins] invoke network error', pluginId, cause);
    throw new Error(
      `Соединение с сервером прервано во время аудита (${cause}). ` +
        'Плагин мог продолжить работу — проверьте логи сервиса и таймауты прокси.',
    );
  }
  if (!resp.ok) {
    let detail = '';
    try {
      const body = await resp.json();
      const raw = body?.detail ?? body?.message;
      detail = typeof raw === 'string' ? raw.trim() : raw ? JSON.stringify(raw) : '';
    } catch {
      /* тело не JSON (HTML-страница прокси) — остаёмся на статусе */
    }
    console.warn('[plugins] invoke failed', pluginId, resp.status, detail);
    // statusText по HTTP/2 всегда пустой, поэтому сообщение строим от кода ответа.
    const fallback =
      resp.status === 504
        ? 'Плагин не ответил за отведённое время (таймаут шлюза). Сервис может всё ещё считать.'
        : resp.status === 502
          ? 'Сервис плагина недоступен или оборвал соединение (502).'
          : `Запрос к плагину завершился с кодом ${resp.status}${
              resp.statusText ? ` (${resp.statusText})` : ''
            }.`;
    throw new Error(detail || fallback);
  }
  const payload = (await resp.json()) as PluginInvokeResult;
  console.info('[plugins] invoke ok', pluginId, {
    status: payload?.result?.status,
    markdownLen: payload?.markdown?.length ?? 0,
    hasResult: Boolean(payload?.result),
  });
  return payload;
}

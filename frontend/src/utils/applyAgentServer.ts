/**
 * Загрузка весов модели агента на сервер (без перезаписи глобальных настроек «Модели»).
 * Промпт и тонкая настройка берутся из карточки агента в БД при каждом сообщении в чате.
 */
import { getApiUrl } from '../config/api';

function sanitizeModelPath(p: string): string {
  let s = p.trim().replace(/\s+/g, '');
  if (/^1lm-svc:\/\//i.test(s)) {
    s = 'llm-svc://' + s.slice(10);
  }
  return s;
}

export async function loadAgentModelOnly(
  token: string,
  model_path?: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  let mp = typeof model_path === 'string' ? sanitizeModelPath(model_path) : '';
  if (!mp) {
    return { ok: true };
  }
  if (!mp.startsWith('llm-svc://') && !mp.includes('/') && !mp.toLowerCase().endsWith('.gguf')) {
    mp = `llm-svc://${mp}`;
  }

  const jsonHeaders: HeadersInit = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const loadRes = await fetch(getApiUrl('/api/models/load'), {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ model_path: mp }),
  });
  const loadData = (await loadRes.json().catch(() => ({}))) as {
    success?: boolean;
    message?: string;
    detail?: string;
  };
  if (!loadRes.ok || !loadData.success) {
    return {
      ok: false,
      message: loadData.message || loadData.detail || 'Не удалось загрузить модель агента',
    };
  }
  return { ok: true };
}

/**
 * @deprecated Не перезаписывает глобальные настройки. Используйте loadAgentModelOnly.
 */
export async function applyAgentModelAndSettings(
  token: string,
  opts: {
    system_prompt: string;
    model_path?: string | null;
    model_settings?: Record<string, unknown> | null;
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  return loadAgentModelOnly(token, opts.model_path);
}

/** Разбор ответа плагина в markdown-вердикт (используют страница и контекст запусков). */

import type { PluginInvokeResult } from './types';

export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const mm = Math.floor(safe / 60);
  const ss = safe % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export function normalizeInvokeResult(
  raw: PluginInvokeResult['result'] | undefined,
): PluginInvokeResult['result'] {
  if (!raw || typeof raw !== 'object') return {};
  const nested = raw.result;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as PluginInvokeResult['result'];
  }
  return raw;
}

export function buildVerdictMarkdown(result: PluginInvokeResult['result'] | undefined): string {
  const payload = normalizeInvokeResult(result);
  if (!payload || !Object.keys(payload).length) return '';

  const md = payload.verdict_markdown;
  if (typeof md === 'string' && md.trim()) return md.trim();

  const lines: string[] = [
    '# Аудит денежного потока',
    '',
    `**Статус:** \`${payload.status || 'unknown'}\``,
    '',
  ];
  if (payload.message) {
    lines.push(String(payload.message), '');
  }
  const steps = payload.steps;
  if (steps && typeof steps === 'object' && Object.keys(steps).length) {
    lines.push('## Выполненные шаги', '');
    for (const [key, done] of Object.entries(steps)) {
      lines.push(`- ${key}: ${done ? 'ok' : '—'}`);
    }
    lines.push('');
  }
  const findings = payload.deterministic_findings || [];
  if (findings.length) {
    lines.push('## Детерминированные находки', '');
    for (const f of findings.slice(0, 50)) {
      const where = f.where || '';
      const ftype = f.type || '?';
      const detail = f.detail || '';
      lines.push(`- **[${ftype}]** ${where}${detail ? ` — ${detail}` : ''}`);
    }
  } else if (payload.status === 'degraded') {
    lines.push(
      '_Полный вердикт недоступен без LLM. Детерминированных находок по формулам не обнаружено._',
      '',
    );
  }
  return lines.join('\n').trim();
}

export function extractMarkdownFromResponse(res: PluginInvokeResult): string {
  if (typeof res.markdown === 'string' && res.markdown.trim()) {
    return res.markdown.trim();
  }
  const fromResult = buildVerdictMarkdown(normalizeInvokeResult(res.result));
  if (fromResult.trim()) return fromResult;
  const raw = res.result;
  if (
    raw &&
    typeof raw === 'object' &&
    typeof (raw as { verdict_markdown?: unknown }).verdict_markdown === 'string'
  ) {
    const direct = String((raw as { verdict_markdown: string }).verdict_markdown).trim();
    if (direct) return direct;
  }
  return '';
}

/** Человеческая сводка по status из ответа сервиса. */
export function summaryForResultStatus(status?: string): string {
  if (status === 'ok') {
    return 'Аудит завершён — отчёт ниже. При необходимости нажмите «Скачать .md».';
  }
  if (status === 'degraded') {
    return 'Аудит завершён в degraded-режиме (без LLM): показаны только детерминированные находки.';
  }
  return `Аудит завершён со статусом: ${status || 'unknown'}.`;
}

/** Короткий текст для уведомления/плашки. */
export function notificationForResultStatus(status?: string): string {
  if (status === 'ok') return 'Аудит завершён';
  if (status === 'degraded') return 'Аудит в degraded-режиме (без LLM)';
  return `Статус: ${status || 'done'}`;
}

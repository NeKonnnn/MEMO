/** Открытие артефакта в отдельной вкладке (как presentation-viewer). */

import {
  repairMermaidSource,
  sanitizeMermaidSource,
  stripMermaidStyling,
} from './artifacts';

export interface ArtifactViewerPayload {
  type: string;
  content: string;
  title?: string;
}

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function looksLikeMermaid(content: string): boolean {
  return /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|xychart-beta|xychart)\b/m.test(
    content || '',
  );
}

function looksLikeSvg(content: string): boolean {
  return /^\s*<svg[\s>]/i.test(content || '');
}

function shellPage(title: string, bodyInner: string, meta = ''): string {
  const svgStage = meta === 'Mermaid' || meta === 'SVG';
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(title)} — AstraChat</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      min-height: 100%;
      background: #e8eaed;
      font-family: 'Segoe UI', system-ui, sans-serif;
      color: #1f2937;
    }
    .wrap {
      max-width: 1100px;
      margin: 0 auto;
      padding: 20px 16px 40px;
    }
    h1 { margin: 0 0 4px; font-size: 1.25rem; font-weight: 650; }
    .meta { margin: 0 0 16px; font-size: 0.8rem; color: #6b7280; }
    #stage {
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      padding: 20px;
      min-height: 280px;
      overflow: auto;
      display: flex;
      justify-content: center;
      align-items: ${svgStage ? 'center' : 'flex-start'};
      ${svgStage ? 'min-height: 60vh;' : ''}
    }
    #stage svg { max-width: 100%; height: auto; display: block; }
    #stage iframe {
      width: 100%;
      min-height: 70vh;
      border: 0;
      border-radius: 8px;
      background: #fff;
    }
    #stage pre {
      margin: 0;
      width: 100%;
      white-space: pre-wrap;
      font-family: Consolas, monospace;
      font-size: 13px;
      color: #111827;
    }
    .error {
      margin: 0 0 16px;
      padding: 12px 14px;
      background: #fee2e2;
      color: #991b1b;
      border-radius: 8px;
      font-size: 14px;
      white-space: pre-wrap;
      width: 100%;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escHtml(title)}</h1>
    ${meta ? `<p class="meta">${escHtml(meta)}</p>` : ''}
    <div id="stage">${bodyInner}</div>
  </div>
</body>
</html>`;
}

/** Надёжнее document.write: blob URL не ломается после async. */
function navigatePopup(win: Window, html: string) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    win.location.replace(url);
  } catch {
    try {
      win.location.href = url;
    } catch {
      /* ignore */
    }
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

let mermaidInitDone = false;

async function renderMermaidToSvg(raw: string): Promise<string> {
  const mermaid = (await import('mermaid')).default;
  if (!mermaidInitDone) {
    mermaid.initialize({
      startOnLoad: false,
      suppressErrorRendering: true,
      securityLevel: 'loose',
      theme: 'neutral',
    });
    mermaidInitDone = true;
  }

  // Нормализуем переносы: модель иногда отдаёт всё в одну строку
  const normalized = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/([;\]])\s+(?=[A-Za-zА-Яа-я])/g, '$1\n');

  const variants = [
    sanitizeMermaidSource(normalized),
    repairMermaidSource(normalized),
    stripMermaidStyling(normalized),
  ].filter((v, i, arr) => v && arr.indexOf(v) === i);

  let lastErr: unknown = null;
  for (let i = 0; i < variants.length; i++) {
    const id = `artifact-ext-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      await mermaid.parse(variants[i]);
      const { svg } = await mermaid.render(id, variants[i]);
      try {
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
      } catch {
        /* ignore */
      }
      if (svg && /<svg[\s>]/i.test(svg)) return svg;
    } catch (e) {
      lastErr = e;
      try {
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
      } catch {
        /* ignore */
      }
    }
  }
  throw lastErr || new Error('Не удалось отрисовать Mermaid');
}

/**
 * Открывает артефакт в новой вкладке.
 * Mermaid: предпочитаем уже готовый SVG (из чата) или рендерим локальным mermaid → blob HTML.
 */
export async function openArtifactViewer(payload: ArtifactViewerPayload): Promise<void> {
  const title = (payload.title || 'Артефакт').trim() || 'Артефакт';
  const type = (payload.type || '').toLowerCase();
  const content = payload.content || '';

  const win = window.open('about:blank', '_blank');
  if (!win) {
    throw new Error('Всплывающее окно заблокировано браузером');
  }
  navigatePopup(win, shellPage(title, '<p style="margin:0;color:#6b7280">Загрузка…</p>', '…'));

  try {
    // Уже SVG (из DOM-превью чата)
    if (type === 'image/svg+xml' || looksLikeSvg(content)) {
      navigatePopup(win, shellPage(title, content, 'SVG'));
      return;
    }

    const isMermaid = type === 'application/vnd.mermaid' || looksLikeMermaid(content);
    if (isMermaid) {
      const svg = await renderMermaidToSvg(content);
      navigatePopup(win, shellPage(title, svg, 'Mermaid'));
      return;
    }

    if (type === 'text/html' || type === 'application/vnd.code-html') {
      let html = content;
      if (!/<!doctype/i.test(html) && !/<html[\s>]/i.test(html)) {
        html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:system-ui,sans-serif;padding:16px;color:#111}</style></head><body>${content}</body></html>`;
      }
      const srcdocAttr = html.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      navigatePopup(
        win,
        shellPage(
          title,
          `<iframe style="width:100%;min-height:70vh;border:0;border-radius:8px" sandbox="allow-scripts allow-same-origin allow-forms" srcdoc="${srcdocAttr}"></iframe>`,
          'HTML',
        ),
      );
      return;
    }

    if (type === 'text/markdown' || type === 'text/md') {
      navigatePopup(win, shellPage(title, `<pre>${escHtml(content)}</pre>`, 'Markdown'));
      return;
    }

    navigatePopup(
      win,
      shellPage(
        title,
        `<p style="margin:0 0 12px;color:#6b7280;font-size:14px;width:100%">Интерактивный preview в отдельной вкладке ограничен. Исходный код:</p><pre>${escHtml(content)}</pre>`,
        type || 'unknown',
      ),
    );
  } catch (e: any) {
    const msg = e?.message || String(e) || 'Ошибка открытия';
    navigatePopup(
      win,
      shellPage(
        title,
        `<div class="error">${escHtml(msg)}</div><pre>${escHtml(content)}</pre>`,
        'Ошибка',
      ),
    );
  }
}

export function sourceLabelForArtifactType(type: string): string {
  const t = (type || '').toLowerCase();
  if (t === 'application/vnd.mermaid') return 'Mermaid';
  if (t === 'text/markdown' || t === 'text/md') return 'Markdown';
  if (t === 'text/html' || t === 'application/vnd.code-html') return 'HTML';
  if (t === 'image/svg+xml') return 'SVG';
  if (t === 'application/vnd.react' || t === 'application/vnd.ant.react') return 'React';
  return 'код';
}

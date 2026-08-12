import type { ArtifactContentSegment, ChatArtifact } from '../types/artifacts';

const ATTR_RE = /(\w+)=["']([^"']*)["']/g;

/** Открывающий блок артефакта + fence (закрытый или стримящийся). */
const ARTIFACT_BLOCK_RE =
  /:::artifact\{([^}]*)\}\s*\n(`{3,})([^\n]*)\n([\s\S]*?)(?:\2\s*\n:::|$)/g;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(raw)) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

function makeId(identifier: string, type: string, title: string, messageId?: string): string {
  const base = `${identifier}_${type}_${title}_${messageId || 'msg'}`
    .replace(/\s+/g, '_')
    .toLowerCase();
  return base || 'artifact';
}

/** Чистит тело артефакта от markdown-обёрток, попавших в content. */
export function sanitizeArtifactBody(raw: string, fenceLang?: string): string {
  let code = (raw || '').replace(/\r\n/g, '\n');

  code = code.replace(/^:::artifact\{[^}]*\}\s*\n?/i, '');
  code = code.replace(/\n?:::\s*$/g, '');

  code = code
    .split('\n')
    .filter((line) => !/^`{3,}\s*\w*\s*$/.test(line.trim()))
    .join('\n');

  code = code.replace(/^`{3,}(?:[\w-]*)?\s*/i, '').replace(/\s*`{3,}\s*$/g, '');

  const lang = (fenceLang || '').trim().toLowerCase();
  if (lang && code.toLowerCase().startsWith(lang + '\n')) {
    code = code.slice(lang.length + 1);
  } else if (/^(mermaid|tsx|jsx|html|svg|markdown|md)\s*\n/i.test(code)) {
    code = code.replace(/^(mermaid|tsx|jsx|html|svg|markdown|md)\s*\n/i, '');
  }

  const innerFence = code.search(/\n`{3,}/);
  if (innerFence >= 0) {
    code = code.slice(0, innerFence);
  }

  return code.replace(/^\n+/, '').replace(/\n+$/, '');
}

/** Чистый исходник Mermaid для рендера (без markdown-обёрток). */
export function sanitizeMermaidSource(raw: string): string {
  let code = sanitizeArtifactBody(raw, 'mermaid');

  const start = code.search(
    /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|xychart-beta|xychart|quadrantChart|sankey-beta|block-beta)\b/im,
  );
  if (start > 0) {
    code = code.slice(start);
  }

  if (/^`+$/m.test(code)) {
    code = code
      .split('\n')
      .filter((line) => !/^`+$/.test(line.trim()))
      .join('\n');
  }

  return code.trim();
}

const CYRILLIC_RE = /[\u0400-\u04FF]/;
/** CSS-свойства, которые модели пихают в `style`, хотя Mermaid их не понимает. */
const INVALID_STYLE_CSS_RE =
  /\b(text-align|font-weight|font-size|font-family|line-height|padding|margin|display|width|height|border-radius)\b/i;

/**
 * Чинит типичный битый Mermaid от LLM:
 * - style с CSS вроде text-align:center (ломает lexer на ':')
 * - style/class с кириллическими id узлов
 * - кривой `Node :: class` вместо `:::class`
 */
export function repairMermaidSource(raw: string): string {
  let code = sanitizeMermaidSource(raw);
  if (!code) return code;

  const lines = code.split('\n');
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^style\s+/i.test(trimmed)) {
      if (INVALID_STYLE_CSS_RE.test(trimmed) || CYRILLIC_RE.test(trimmed)) {
        continue;
      }
      if (/^(pie|xychart)/i.test(code)) {
        continue;
      }
      out.push(line);
      continue;
    }

    if (/^(classDef|class|linkStyle|click)\s+/i.test(trimmed)) {
      if (CYRILLIC_RE.test(trimmed) || INVALID_STYLE_CSS_RE.test(trimmed)) {
        continue;
      }
      out.push(line);
      continue;
    }

    let fixed = line.replace(/(\))\s*:{2,3}\s*[A-Za-z_][\w-]*/g, '$1');
    fixed = fixed.replace(/(\b[A-Za-z][\w]*)\s*:{2,3}\s*[A-Za-z_][\w-]*(?=\s|$)/g, '$1');

    out.push(fixed);
  }

  return out.join('\n').trim();
}

/**
 * Агрессивный fallback: выкинуть ВСЕ style/classDef/class/linkStyle/click.
 * Часто после этого flowchart/pie уже рендерится.
 */
export function stripMermaidStyling(raw: string): string {
  const code = repairMermaidSource(raw);
  return code
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !/^(style|classDef|class|linkStyle|click)\s+/i.test(t);
    })
    .join('\n')
    .trim();
}

/**
 * Разбивает текст сообщения на обычный markdown и артефакты.
 * Незавершённый (стриминг) блок без закрывающего ::: тоже попадает в результат.
 */
export function splitContentWithArtifacts(
  text: string,
  options?: { messageId?: string; isStreaming?: boolean },
): ArtifactContentSegment[] {
  if (!text) return [{ kind: 'text', text: '' }];

  const messageId = options?.messageId;
  const segments: ArtifactContentSegment[] = [];
  let lastIndex = 0;
  ARTIFACT_BLOCK_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ARTIFACT_BLOCK_RE.exec(text)) !== null) {
    const full = match[0];
    const attrsRaw = match[1] || '';
    const fence = match[2] || '````';
    const fenceLang = match[3] || '';
    let body = match[4] ?? '';

    const start = match.index;
    if (start > lastIndex) {
      segments.push({ kind: 'text', text: text.slice(lastIndex, start) });
    }

    const closed = full.trimEnd().endsWith(':::');
    const attrs = parseAttrs(attrsRaw);
    const identifier = (attrs.identifier || 'untitled').trim() || 'untitled';
    const type = (attrs.type || 'text/plain').trim() || 'text/plain';
    const title = (attrs.title || identifier).trim() || identifier;
    const content = sanitizeArtifactBody(body, fenceLang);

    const artifact: ChatArtifact = {
      id: makeId(identifier, type, title, messageId),
      identifier,
      type,
      title,
      content,
      closed,
      messageId,
    };
    segments.push({ kind: 'artifact', artifact });
    lastIndex = start + full.length;
  }

  if (lastIndex < text.length) {
    segments.push({ kind: 'text', text: text.slice(lastIndex) });
  }

  if (segments.length === 0) {
    return [{ kind: 'text', text }];
  }
  return segments;
}

export function extractArtifactsFromText(
  text: string,
  options?: { messageId?: string },
): ChatArtifact[] {
  return splitContentWithArtifacts(text, options)
    .filter((s): s is { kind: 'artifact'; artifact: ChatArtifact } => s.kind === 'artifact')
    .map((s) => s.artifact);
}

export function artifactTypeLabel(type: string): string {
  const t = (type || '').toLowerCase();
  if (t === 'text/html' || t === 'application/vnd.code-html') return 'HTML';
  if (t === 'image/svg+xml') return 'SVG';
  if (t === 'text/markdown' || t === 'text/md') return 'Markdown';
  if (t === 'application/vnd.mermaid') return 'Mermaid';
  if (t === 'application/vnd.react' || t === 'application/vnd.ant.react') return 'React';
  return type || 'Artifact';
}

export function isHtmlArtifactType(type: string): boolean {
  const t = (type || '').toLowerCase();
  return t === 'text/html' || t === 'application/vnd.code-html';
}

export function isReactArtifactType(type: string): boolean {
  const t = (type || '').toLowerCase();
  return t === 'application/vnd.react' || t === 'application/vnd.ant.react';
}

export function isMarkdownArtifactType(type: string): boolean {
  const t = (type || '').toLowerCase();
  return t === 'text/markdown' || t === 'text/md';
}

export function isMermaidArtifactType(type: string): boolean {
  return (type || '').toLowerCase() === 'application/vnd.mermaid';
}

export function isSvgArtifactType(type: string): boolean {
  return (type || '').toLowerCase() === 'image/svg+xml';
}

export function guessCodeLanguage(type: string): string {
  if (isHtmlArtifactType(type)) return 'html';
  if (isSvgArtifactType(type)) return 'xml';
  if (isMarkdownArtifactType(type)) return 'markdown';
  if (isMermaidArtifactType(type)) return 'mermaid';
  if (isReactArtifactType(type)) return 'tsx';
  return 'plaintext';
}

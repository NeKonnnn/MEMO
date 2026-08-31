const STORAGE_PREFIX = 'astrachat:presentation:';

/**
 * class="…" / class='…' — значение целиком (нежадный, с учётом переносов).
 * Нужен, чтобы отличать токен `slide` от `slide-title` / `slide-title--xl`.
 */
const CLASS_ATTR_QUOTED_RE = /\bclass\s*=\s*(["'])([\s\S]*?)\1/gi;

/** <tag … class="…slide…"> — для подсчёта открывающих слайдов в стриме. */
const SLIDE_OPEN_QUOTED_RE =
  /<([a-zA-Z][\w-]*)\b[^>]*\bclass\s*=\s*(["'])([\s\S]*?)\2[^>]*>/gi;

const SLIDE_OPEN_UNQUOTED_RE =
  /<([a-zA-Z][\w-]*)\b[^>]*\bclass\s*=\s*slide\b[^>]*>/gi;

/** В значении class есть отдельный токен `slide` (не slide-title / slides). */
export function classAttrHasSlideToken(classValue: string): boolean {
  return classValue
    .trim()
    .split(/\s+/)
    .some((token) => token === 'slide');
}

/** В HTML есть элемент с class-токеном `slide`. */
export function hasGpbSlideClass(code: string): boolean {
  if (!code) return false;

  const quoted = new RegExp(CLASS_ATTR_QUOTED_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = quoted.exec(code)) !== null) {
    if (classAttrHasSlideToken(m[2])) return true;
  }

  return /\bclass\s*=\s*slide\b/i.test(code);
}

/** Сколько открывающих тегов с class-токеном slide уже есть в потоке. */
export function countGpbSlideOpens(code: string): number {
  if (!code) return 0;
  let count = 0;

  const quoted = new RegExp(SLIDE_OPEN_QUOTED_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = quoted.exec(code)) !== null) {
    if (classAttrHasSlideToken(m[3])) count += 1;
  }

  const unquoted = new RegExp(SLIDE_OPEN_UNQUOTED_RE.source, 'gi');
  while ((m = unquoted.exec(code)) !== null) {
    count += 1;
  }

  return count;
}

/** Fence-язык блока — HTML (без учёта регистра). */
export function isHtmlFenceLanguage(language: string | undefined | null): boolean {
  const lang = (language || '').trim().toLowerCase();
  return lang === 'html' || lang === 'htm' || lang === 'xhtml';
}

/** Открывающая строка markdown-fence — ```html / ```htm / ```xhtml. */
export function isHtmlFenceBlock(codeBlock: string): boolean {
  return /```(?:html|htm|xhtml)\b/i.test(codeBlock || '');
}

/** Языки fence, которые точно не GPB-презентация. */
const NON_PRESENTATION_FENCE_LANGS = new Set([
  'python', 'py', 'javascript', 'js', 'typescript', 'ts', 'json', 'sql', 'bash', 'sh', 'shell',
  'yaml', 'yml', 'csv', 'svg', 'mermaid', 'mmd', 'tsx', 'jsx', 'java', 'c', 'cpp', 'c++', 'go',
  'rust', 'rs', 'rb', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'r', 'matlab', 'vba', 'powershell', 'ps1',
]);

/**
 * Стрим презентации: viewer сразу (спиннер), без Monaco.
 * Срабатывает при presentation skill/агенте + ```html, ещё до первого .slide.
 */
export function shouldTreatHtmlFenceAsPresentationStream(
  code: string,
  codeBlock: string,
  language: string | undefined | null,
  opts: { isStreaming?: boolean; presentationExpected?: boolean } = {},
): boolean {
  if (!opts.isStreaming || !opts.presentationExpected) return false;
  const lang = (language || '').trim().toLowerCase();
  if (lang && NON_PRESENTATION_FENCE_LANGS.has(lang)) return false;
  const body = (code || '').trim();
  if (isGpbPresentationStreaming(body, lang)) return true;
  if (body && hasPresentationStreamHints(body)) return true;
  return false;
}

/**
 * HTML-блок презентации GPB: обязателен реальный class-токен `slide`.
 * Одних CSS-классов скилла (.slide-title / .content-zone) или путей иконок мало —
 * иначе viewer открывается и падает с «не найдены слайды с классом .slide».
 */
export function isGpbPresentationHtml(code: string): boolean {
  if (!code || code.length < 40) return false;
  if (!hasGpbSlideClass(code)) return false;

  const lower = code.toLowerCase();
  const looksLikeHtml =
    lower.includes('<div') ||
    lower.includes('<section') ||
    lower.includes('<html') ||
    lower.includes('<!doctype');

  return looksLikeHtml;
}

/**
 * Во время стрима: показать chrome презентации (спиннер), если уже видны
 * признаки GPB-скилла. В iframe попадают только готовые `.slide`.
 */
export function isGpbPresentationStreaming(code: string, _language?: string | null): boolean {
  if (isGpbPresentationHtml(code)) return true;
  if (!code || code.length < 8) return false;
  return hasPresentationStreamHints(code);
}

/** Показывать GPB viewer: готовые .slide или стрим/skill презентации с признаками GPB HTML. */
export function shouldOpenPresentationViewer(
  code: string,
  opts: {
    isStreaming?: boolean;
    presentationExpected?: boolean;
    language?: string | null;
  } = {},
): boolean {
  if (isGpbPresentationHtml(code)) return true;
  // Skill презентации: HTML с признаками GPB — и во время стрима, и после (без fence-only).
  if (opts.presentationExpected && isGpbPresentationStreaming(code, opts.language)) {
    return true;
  }
  // Обычный ```html (Excel-дашборд и т.п.) — ArtifactCard, не presentation viewer.
  return false;
}

/**
 * Выделяет unfenced HTML презентации из текста ответа.
 * Модели часто отдают GPB HTML без ```html — иначе ChatInlineHtml рисует img/иконки в ленте.
 */
export function extractUnfencedPresentationHtml(text: string): {
  before: string;
  html: string | null;
  after: string;
} {
  if (!text || !text.includes('<')) {
    return { before: text || '', html: null, after: '' };
  }
  // Уже внутри markdown-fence — не трогаем (разбирает renderCodeBlock).
  if (/```/.test(text) && /```(?:html|htm|xhtml)?\b/i.test(text)) {
    return { before: text, html: null, after: '' };
  }

  const startCandidates = [
    text.search(/<!DOCTYPE\s+html\b/i),
    text.search(/<html\b/i),
    text.search(/<head\b/i),
    text.search(/<style\b/i),
    text.search(/<[a-z][\w-]*\b[^>]*\bclass\s*=\s*(["'])[^"'>\n]*\bslide\b/i),
  ].filter((i) => i >= 0);

  if (!startCandidates.length) {
    if (isGpbPresentationHtml(text) || hasGpbSlideClass(text)) {
      return { before: '', html: text, after: '' };
    }
    return { before: text, html: null, after: '' };
  }

  const start = Math.min(...startCandidates);
  const html = text.slice(start);
  if (!isGpbPresentationHtml(html) && !hasGpbSlideClass(html) && !isGpbPresentationStreaming(html)) {
    return { before: text, html: null, after: '' };
  }
  return { before: text.slice(0, start), html, after: '' };
}

/** Куски HTML от каждого открывающего .slide до следующего (работает на обрезанном стриме). */
export function extractGpbSlideFragments(code: string): string[] {
  if (!code) return [];
  const starts: number[] = [];

  const quoted = new RegExp(SLIDE_OPEN_QUOTED_RE.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = quoted.exec(code)) !== null) {
    if (classAttrHasSlideToken(m[3])) starts.push(m.index);
  }
  const unquoted = new RegExp(SLIDE_OPEN_UNQUOTED_RE.source, 'gi');
  while ((m = unquoted.exec(code)) !== null) {
    starts.push(m.index);
  }
  starts.sort((a, b) => a - b);
  const unique: number[] = [];
  for (const idx of starts) {
    if (!unique.length || idx - unique[unique.length - 1] > 2) unique.push(idx);
  }
  return unique.map((start, i) => {
    const end = i + 1 < unique.length ? unique[i + 1] : code.length;
    return code.slice(start, end);
  });
}

function extractPresentationHeadChrome(code: string, firstSlideIndex: number): string {
  const head = firstSlideIndex > 0 ? code.slice(0, firstSlideIndex) : code;
  const links = head.match(/<link\b[^>]*rel\s*=\s*['"]stylesheet['"][^>]*>/gi) || [];
  const styles = head.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || [];
  return [...links, ...styles].join('\n');
}

function wrapPresentationSlidesHtml(chrome: string, slidesHtml: string): string {
  return `<!DOCTYPE html><html><head>${chrome}</head><body>${slidesHtml}</body></html>`;
}

/** Мягкие признаки скилла — только для спиннера «генерация…» во время стрима. */
function hasPresentationStreamHints(code: string): boolean {
  const lower = code.toLowerCase();
  return (
    hasGpbSlideClass(code) ||
    lower.includes('/static/icons/gpb_') ||
    lower.includes('/static/icons_new/') ||
    lower.includes('content-zone') ||
    lower.includes('slide-title') ||
    lower.includes('slide-header') ||
    lower.includes('gpb-slide') ||
    lower.includes('--gpb-') ||
    // GPB mm-формат (не `.slide` в CSS — ложное срабатывание на обычных HTML-дашбордах)
    (lower.includes('<style') && (lower.includes('297mm') || lower.includes('167mm')))
  );
}

/**
 * Заголовок/identifier артефакта намекает на презентацию (до появления .slide в HTML).
 */
export function artifactMetaLooksLikePresentation(meta?: {
  title?: string | null;
  identifier?: string | null;
  type?: string | null;
}): boolean {
  const blob = `${meta?.title || ''} ${meta?.identifier || ''} ${meta?.type || ''}`.toLowerCase();
  return /present|презента|слайд|slide|gpb.?html|deck/.test(blob);
}

export interface StablePresentationSnapshot {
  /** HTML только с «зафиксированными» слайдами (без текущего недописанного). */
  html: string | null;
  /** Сколько слайдов уже можно показывать. */
  readyCount: number;
  /** Сколько открывающих .slide уже встретилось в потоке. */
  startedCount: number;
  /** Ещё идёт генерация текущего слайда. */
  pending: boolean;
}

/**
 * Для стрима: последний .slide почти всегда обрезан — его не показываем,
 * чтобы iframe не мерцал на каждый токен. Обновляем snapshot только когда
 * появляется новый слайд (предыдущий считается готовым).
 */
export function getStablePresentationSnapshot(
  code: string,
  isStreaming: boolean
): StablePresentationSnapshot {
  const fragments = extractGpbSlideFragments(code);
  const startedCount = Math.max(countGpbSlideOpens(code), fragments.length);

  if (!code.trim()) {
    return { html: null, readyCount: 0, startedCount: 0, pending: isStreaming };
  }

  if (!isStreaming) {
    try {
      const doc = new DOMParser().parseFromString(code, 'text/html');
      const n = doc.querySelectorAll('.slide').length;
      const readyCount = Math.max(n, fragments.length);
      if (readyCount === 0) {
        return { html: null, readyCount: 0, startedCount: 0, pending: false };
      }
      return {
        html: code,
        readyCount,
        startedCount: Math.max(startedCount, readyCount),
        pending: false,
      };
    } catch {
      if (!fragments.length) {
        return { html: null, readyCount: 0, startedCount: 0, pending: false };
      }
      const chrome = extractPresentationHeadChrome(code, code.indexOf(fragments[0]));
      return {
        html: wrapPresentationSlidesHtml(chrome, fragments.join('\n')),
        readyCount: fragments.length,
        startedCount: fragments.length,
        pending: false,
      };
    }
  }

  // Пока стрим: последний .slide почти всегда обрезан — его не показываем.
  // Фрагменты по regex, не DOMParser: на обрезанном HTML парсер «съедает» хвост.
  const readyCount = Math.max(0, startedCount - 1);
  if (readyCount === 0 || !fragments.length) {
    return { html: null, readyCount: 0, startedCount, pending: true };
  }

  const readyFragments = fragments.slice(0, Math.min(readyCount, fragments.length));
  if (!readyFragments.length) {
    return { html: null, readyCount: 0, startedCount, pending: true };
  }
  const chrome = extractPresentationHeadChrome(code, code.indexOf(readyFragments[0]));
  return {
    html: wrapPresentationSlidesHtml(chrome, readyFragments.join('\n')),
    readyCount: readyFragments.length,
    startedCount,
    pending: true,
  };
}

/**
 * Открывает viewer с HTML презентации в новой вкладке.
 * Используем localStorage (не sessionStorage): при window.open с noopener
 * новая вкладка получает пустой sessionStorage и HTML «теряется».
 */
export function openPresentationViewer(html: string): void {
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, html);
  } catch {
    throw new Error('Не удалось сохранить HTML презентации (слишком большой объём?)');
  }
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  // Без noopener/noreferrer — иначе в части браузеров storage не шарится вовремя.
  const win = window.open(
    `${base}/presentation-viewer.html?key=${encodeURIComponent(key)}`,
    '_blank'
  );
  if (!win) {
    localStorage.removeItem(STORAGE_PREFIX + key);
    throw new Error('Всплывающее окно заблокировано браузером');
  }
}

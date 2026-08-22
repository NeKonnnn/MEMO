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

/** Мягкие признаки скилла — только для спиннера «генерация…» во время стрима. */
function hasPresentationStreamHints(code: string): boolean {
  const lower = code.toLowerCase();
  return (
    hasGpbSlideClass(code) ||
    lower.includes('/static/icons/gpb_') ||
    lower.includes('/static/icons_new/') ||
    lower.includes('content-zone') ||
    lower.includes('slide-title')
  );
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
  const startedCount = countGpbSlideOpens(code);

  if (!code.trim()) {
    return { html: null, readyCount: 0, startedCount: 0, pending: isStreaming };
  }

  if (!isStreaming) {
    try {
      const doc = new DOMParser().parseFromString(code, 'text/html');
      const n = doc.querySelectorAll('.slide').length;
      if (n === 0) {
        // Нет реальных .slide — не кормим viewer (избегаем красной ошибки).
        return { html: null, readyCount: 0, startedCount: 0, pending: false };
      }
      return {
        html: code,
        readyCount: n,
        startedCount: Math.max(startedCount, n),
        pending: false,
      };
    } catch {
      return { html: null, readyCount: 0, startedCount: 0, pending: false };
    }
  }

  // Пока стрим: все слайды кроме последнего считаем готовыми.
  const readyCount = Math.max(0, startedCount - 1);
  if (readyCount === 0) {
    return { html: null, readyCount: 0, startedCount, pending: true };
  }

  try {
    const doc = new DOMParser().parseFromString(code, 'text/html');
    const slides = Array.from(doc.querySelectorAll('.slide'));
    const readySlides = slides.slice(0, readyCount);
    if (!readySlides.length) {
      return { html: null, readyCount: 0, startedCount, pending: true };
    }

    const styles = Array.from(doc.querySelectorAll('style'))
      .map((s) => s.outerHTML)
      .join('\n');
    const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))
      .map((l) => l.outerHTML)
      .join('\n');

    const html = `<!DOCTYPE html><html><head>${links}${styles}</head><body>${readySlides
      .map((s) => s.outerHTML)
      .join('\n')}</body></html>`;

    return { html, readyCount: readySlides.length, startedCount, pending: true };
  } catch {
    return { html: null, readyCount: 0, startedCount, pending: true };
  }
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

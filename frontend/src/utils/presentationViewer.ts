const STORAGE_PREFIX = 'astrachat:presentation:';

const SLIDE_OPEN_RE = /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b[^"']*["'][^>]*>/gi;

/** Fence-язык блока — HTML (без учёта регистра). */
export function isHtmlFenceLanguage(language: string | undefined | null): boolean {
  const lang = (language || '').trim().toLowerCase();
  return lang === 'html' || lang === 'htm' || lang === 'xhtml';
}

/** HTML-блок презентации (слайды .slide из GPB skill). */
export function isGpbPresentationHtml(code: string): boolean {
  if (!code || code.length < 40) return false;
  const normalized = code.replace(/\s+/g, ' ').toLowerCase();

  const hasSlideClass =
    /\bclass\s*=\s*["'][^"']*\bslide\b[^"']*["']/.test(normalized) ||
    /\bclass\s*=\s*slide\b/.test(normalized);

  const hasPresentationHints =
    normalized.includes('/static/icons/gpb_') ||
    normalized.includes('/static/icons_new/') ||
    normalized.includes('content-zone') ||
    normalized.includes('slide-title');

  const looksLikeHtml =
    normalized.includes('<div') ||
    normalized.includes('<html') ||
    normalized.includes('<!doctype');

  return looksLikeHtml && (hasSlideClass || hasPresentationHints);
}

/**
 * Во время стрима: показывать presentation viewer только если уже видны
 * признаки GPB-слайдов (.slide / content-zone / иконки).
 * Обычный ```html (диаграммы, лендинги, отчёты) — НЕ презентация.
 */
export function isGpbPresentationStreaming(code: string, language?: string | null): boolean {
  if (isGpbPresentationHtml(code)) return true;
  if (!code || code.length < 8) return false;

  const lower = code.toLowerCase();
  return (
    /\bclass\s*=\s*["'][^"']*\bslide\b/.test(lower) ||
    /\bclass\s*=\s*slide\b/.test(lower) ||
    lower.includes('content-zone') ||
    lower.includes('slide-title') ||
    lower.includes('/static/icons/gpb_') ||
    lower.includes('/static/icons_new/')
  );
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
  // Свой RegExp на каждый вызов — у /g иначе плывёт lastIndex.
  const slideOpenRe = new RegExp(SLIDE_OPEN_RE.source, 'gi');
  const startedCount = (code.match(slideOpenRe) || []).length;

  if (!code.trim()) {
    return { html: null, readyCount: 0, startedCount: 0, pending: isStreaming };
  }

  if (!isStreaming) {
    return {
      html: code,
      readyCount: Math.max(startedCount, 1),
      startedCount: Math.max(startedCount, 1),
      pending: false,
    };
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

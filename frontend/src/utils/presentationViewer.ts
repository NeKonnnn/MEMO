const STORAGE_PREFIX = 'astrachat:presentation:';

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

/** Fence-язык блока — HTML (без учёта регистра). */
export function isHtmlFenceLanguage(language: string | undefined | null): boolean {
  const lang = (language || '').trim().toLowerCase();
  return lang === 'html' || lang === 'htm' || lang === 'xhtml';
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

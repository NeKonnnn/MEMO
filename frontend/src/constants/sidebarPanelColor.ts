/** Ключ в localStorage для пользовательского цвета боковых панелей. Пустая строка = цвет по умолчанию. */
export const SIDEBAR_PANEL_COLOR_KEY = 'sidebar_panel_color';

/** Градиент по умолчанию для левой и правой боковых панелей. */
export const DEFAULT_SIDEBAR_GRADIENT = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';

const HEX_RE = /#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/;
const RGB_RE = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/;

type Rgb = { r: number; g: number; b: number };

function expandHex(hex: string): Rgb | null {
  const raw = hex.replace('#', '').trim();
  if (raw.length === 3) {
    const r = parseInt(raw[0] + raw[0], 16);
    const g = parseInt(raw[1] + raw[1], 16);
    const b = parseInt(raw[2] + raw[2], 16);
    return { r, g, b };
  }
  if (raw.length === 6) {
    return {
      r: parseInt(raw.slice(0, 2), 16),
      g: parseInt(raw.slice(2, 4), 16),
      b: parseInt(raw.slice(4, 6), 16),
    };
  }
  return null;
}

/** Достаёт «характерный» цвет фона: для градиента — первый hex/rgb. */
export function extractSidebarSampleRgb(background: string): Rgb | null {
  const value = (background || '').trim();
  if (!value) return extractSidebarSampleRgb(DEFAULT_SIDEBAR_GRADIENT);

  const hexMatch = value.match(HEX_RE);
  if (hexMatch) return expandHex(hexMatch[0]);

  const rgbMatch = value.match(RGB_RE);
  if (rgbMatch) {
    return {
      r: Math.min(255, Number(rgbMatch[1])),
      g: Math.min(255, Number(rgbMatch[2])),
      b: Math.min(255, Number(rgbMatch[3])),
    };
  }

  return null;
}

/** Относительная яркость по WCAG (0 = чёрный, 1 = белый). */
export function relativeLuminance(rgb: Rgb): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Светлая ли панель: на ней белые иконки/текст пропадают.
 * Порог ~0.62 — покрывает #EDF5E1 и белый/почти белый custom.
 */
export function isSidebarPanelLight(background?: string): boolean {
  const bg = (background ?? getSidebarPanelBackground()).trim();
  if (!bg) return false;
  const rgb = extractSidebarSampleRgb(bg);
  if (!rgb) return false;
  return relativeLuminance(rgb) >= 0.62;
}

export function getSidebarPanelBackground(): string {
  if (typeof window === 'undefined') return DEFAULT_SIDEBAR_GRADIENT;
  const saved = localStorage.getItem(SIDEBAR_PANEL_COLOR_KEY);
  return saved || DEFAULT_SIDEBAR_GRADIENT;
}

export function getSidebarPanelForeground(background?: string): string {
  return isSidebarPanelLight(background) ? 'rgba(0, 0, 0, 0.87)' : '#ffffff';
}

export function getSidebarPanelMutedForeground(background?: string): string {
  return isSidebarPanelLight(background) ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.75)';
}

export function getSidebarPanelHoverBackground(background?: string): string {
  return isSidebarPanelLight(background) ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.08)';
}

export function getSidebarPanelBorderColor(background?: string): string {
  return isSidebarPanelLight(background) ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.08)';
}

/** Белые PNG-глифы rail на светлой панели инвертируем в тёмные. */
export function getSidebarRailGlyphFilter(background?: string): string {
  return isSidebarPanelLight(background) ? 'invert(1) brightness(0)' : 'none';
}

/**
 * Общие стили хрома левой/правой панели: фон, CSS-переменные контраста, глиф меню.
 * Иконки rail должны брать `var(--sidebar-fg)` (см. SIDEBAR_LIST_ICON_SX).
 */
export function getSidebarChromeSx(background?: string): Record<string, unknown> {
  const bg = background ?? getSidebarPanelBackground();
  const fg = getSidebarPanelForeground(bg);
  const muted = getSidebarPanelMutedForeground(bg);
  const hover = getSidebarPanelHoverBackground(bg);
  const border = getSidebarPanelBorderColor(bg);
  const light = isSidebarPanelLight(bg);
  return {
    background: bg,
    color: fg,
    borderColor: border,
    '--sidebar-fg': fg,
    '--sidebar-muted-fg': muted,
    '--sidebar-hover-bg': hover,
    '--sidebar-border-color': border,
    '--sidebar-selected-bg': light ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.15)',
    transition: 'background 0.3s ease, color 0.3s ease',
    '& [data-memo-rail-menu-glyph]': {
      filter: getSidebarRailGlyphFilter(bg),
    },
  };
}

/**
 * Принудительный контраст для содержимого панели (иконки/текст/кнопки с захардкоженным #fff).
 * Диалоги MUI порталятся наружу — на них не действует.
 * Contained-кнопки (Сохранить и т.п.) оставляем со светлым текстом/иконками.
 */
export function getSidebarForcedContrastSx(background?: string): Record<string, unknown> {
  const bg = background ?? getSidebarPanelBackground();
  if (!isSidebarPanelLight(bg)) return {};
  const fg = getSidebarPanelForeground(bg);
  const muted = getSidebarPanelMutedForeground(bg);
  const border = getSidebarPanelBorderColor(bg);
  const hover = getSidebarPanelHoverBackground(bg);
  return {
    '& .MuiSvgIcon-root': { color: `${fg} !important` },
    '& .MuiTypography-root': { color: `${fg} !important` },
    '& .MuiIconButton-root': { color: `${fg} !important` },
    '& .MuiListItemIcon-root': { color: `${fg} !important` },
    '& .MuiListItemText-primary, & .MuiListItemText-secondary': { color: `${fg} !important` },
    '& .MuiFormControlLabel-label': { color: `${fg} !important` },
    '& .MuiFormLabel-root': { color: `${muted} !important` },
    '& .MuiInputBase-root': { color: `${fg} !important` },
    '& .MuiInputBase-input': {
      color: `${fg} !important`,
      WebkitTextFillColor: fg,
    },
    '& .MuiInputBase-input::placeholder': {
      color: `${muted} !important`,
      opacity: '1 !important',
      WebkitTextFillColor: muted,
    },
    '& .MuiOutlinedInput-notchedOutline': { borderColor: `${border} !important` },
    '& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: `${muted} !important`,
    },
    '& .MuiButton-root:not(.MuiButton-contained)': {
      color: `${fg} !important`,
      borderColor: `${border} !important`,
      '&:hover': {
        backgroundColor: `${hover} !important`,
        borderColor: `${fg} !important`,
      },
      '&.Mui-disabled': {
        color: `${muted} !important`,
        borderColor: `${border} !important`,
      },
    },
    '& .MuiButton-contained': {
      color: '#ffffff !important',
    },
    '& .MuiButton-contained .MuiSvgIcon-root': { color: '#ffffff !important' },
    '& .MuiButton-contained .MuiCircularProgress-root': { color: '#ffffff !important' },
    '& .MuiButton-contained.Mui-disabled': {
      color: 'rgba(255,255,255,0.7) !important',
    },
    '& .MuiCheckbox-root': { color: `${muted} !important` },
    '& .MuiCheckbox-root.Mui-checked': { color: '#1976d2 !important' },
    '& .MuiCircularProgress-root': { color: `${fg} !important` },
  };
}

export const RIGHT_SIDEBAR_DEFAULT_WIDTH_PX = 240;
export const RIGHT_SIDEBAR_MIN_WIDTH_PX = 240;
export const RIGHT_SIDEBAR_MAX_WIDTH_PX = 720;

export const RIGHT_SIDEBAR_WIDTH_STORAGE_KEY = 'rightSidebarWidth';
export const RIGHT_SIDEBAR_WIDTH_PINNED_STORAGE_KEY = 'rightSidebarWidthPinned';

export function clampRightSidebarWidthPx(width: number): number {
  return Math.min(RIGHT_SIDEBAR_MAX_WIDTH_PX, Math.max(RIGHT_SIDEBAR_MIN_WIDTH_PX, Math.round(width)));
}

export function readRightSidebarWidthPx(): number {
  const saved = localStorage.getItem(RIGHT_SIDEBAR_WIDTH_STORAGE_KEY);
  if (saved === null) return RIGHT_SIDEBAR_DEFAULT_WIDTH_PX;
  const parsed = Number.parseInt(saved, 10);
  if (!Number.isFinite(parsed)) return RIGHT_SIDEBAR_DEFAULT_WIDTH_PX;
  return clampRightSidebarWidthPx(parsed);
}

export function readRightSidebarWidthPinned(): boolean {
  const saved = localStorage.getItem(RIGHT_SIDEBAR_WIDTH_PINNED_STORAGE_KEY);
  return saved === 'true';
}

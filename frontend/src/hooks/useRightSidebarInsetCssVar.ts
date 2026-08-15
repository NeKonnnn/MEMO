import { useEffect, useState } from 'react';

/** Ширина правой панели в развёрнутом и rail-состоянии (как у Drawer). */
export const RIGHT_SIDEBAR_EXPANDED_WIDTH_PX = 240;
export const RIGHT_SIDEBAR_COLLAPSED_WIDTH_PX = 64;
export const RIGHT_SIDEBAR_INSET_CSS_VAR = '--right-sidebar-inset';

export function getRightSidebarInsetPx(open: boolean, hidden: boolean): number {
  if (hidden) return 0;
  return open ? RIGHT_SIDEBAR_EXPANDED_WIDTH_PX : RIGHT_SIDEBAR_COLLAPSED_WIDTH_PX;
}

/** Публикует ширину правой панели в CSS-переменную для fixed-элементов (виджет помощи и т.п.). */
export function useRightSidebarInsetCssVar(open: boolean, hidden: boolean) {
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(RIGHT_SIDEBAR_INSET_CSS_VAR, `${getRightSidebarInsetPx(open, hidden)}px`);
    return () => {
      root.style.setProperty(RIGHT_SIDEBAR_INSET_CSS_VAR, '0px');
    };
  }, [open, hidden]);
}

function readDockedRightRailWidthPx(): number {
  const el = (document.querySelector('.astra-right-rail') ||
    document.querySelector('.MuiDrawer-docked.MuiDrawer-anchorRight .MuiDrawer-paper')) as HTMLElement | null;
  if (!el) return 0;
  const width = el.getBoundingClientRect().width;
  return width > 8 ? Math.round(width) : 0;
}

/** Живая ширина правой docked-панели — для position:fixed виджетов. */
export function useRightRailOffsetPx(): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const apply = () => setWidth(readDockedRightRailWidthPx());
    apply();

    const railRo = new ResizeObserver(apply);
    const watchPaper = () => {
      railRo.disconnect();
      const el =
        document.querySelector('.astra-right-rail') ||
        document.querySelector('.MuiDrawer-docked.MuiDrawer-anchorRight .MuiDrawer-paper');
      if (el) railRo.observe(el);
    };
    watchPaper();

    const mo = new MutationObserver(() => {
      apply();
      watchPaper();
    });
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', apply);
    return () => {
      railRo.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, []);

  return width;
}

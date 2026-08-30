import React, { createContext, useContext, useMemo } from 'react';

export type RightBarLayout = {
  open: boolean;
  hidden: boolean;
  expandedWidthPx: number;
  widthPinned: boolean;
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setHidden: (hidden: boolean | ((prev: boolean) => boolean)) => void;
  setExpandedWidthPx: (widthPx: number | ((prev: number) => number)) => void;
  setWidthPinned: (pinned: boolean | ((prev: boolean) => boolean)) => void;
};

const RightBarContext = createContext<RightBarLayout | null>(null);

export function RightBarProvider({
  value,
  children,
}: {
  value: RightBarLayout;
  children: React.ReactNode;
}) {
  const memo = useMemo(
    () => value,
    [
      value.open,
      value.hidden,
      value.expandedWidthPx,
      value.widthPinned,
      value.setOpen,
      value.setHidden,
      value.setExpandedWidthPx,
      value.setWidthPinned,
    ],
  );
  return <RightBarContext.Provider value={memo}>{children}</RightBarContext.Provider>;
}

export function useRightBarLayout(): RightBarLayout {
  const ctx = useContext(RightBarContext);
  if (!ctx) {
    return {
      open: true,
      hidden: false,
      expandedWidthPx: 240,
      widthPinned: false,
      setOpen: () => undefined,
      setHidden: () => undefined,
      setExpandedWidthPx: () => undefined,
      setWidthPinned: () => undefined,
    };
  }
  return ctx;
}

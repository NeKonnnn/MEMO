import React, { createContext, useContext, useMemo } from 'react';

export type RightBarLayout = {
  open: boolean;
  hidden: boolean;
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setHidden: (hidden: boolean | ((prev: boolean) => boolean)) => void;
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
    [value.open, value.hidden, value.setOpen, value.setHidden],
  );
  return <RightBarContext.Provider value={memo}>{children}</RightBarContext.Provider>;
}

export function useRightBarLayout(): RightBarLayout {
  const ctx = useContext(RightBarContext);
  if (!ctx) {
    return {
      open: true,
      hidden: false,
      setOpen: () => undefined,
      setHidden: () => undefined,
    };
  }
  return ctx;
}

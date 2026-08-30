import React, { useCallback, useRef } from 'react';
import { Box } from '@mui/material';
import { clampRightSidebarWidthPx } from '../../hooks/useRightSidebarWidth';

export interface RightSidebarResizeHandleProps {
  disabled?: boolean;
  onResize: (widthPx: number) => void;
  onResizeEnd?: (widthPx: number) => void;
  onResizeStart?: () => void;
}

export default function RightSidebarResizeHandle({
  disabled = false,
  onResize,
  onResizeEnd,
  onResizeStart,
}: RightSidebarResizeHandleProps) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const paper = (event.currentTarget.closest('.astra-right-rail') ||
        event.currentTarget.closest('.MuiDrawer-paper')) as HTMLElement | null;
      const startWidth = paper?.getBoundingClientRect().width ?? 0;
      if (startWidth <= 0) return;

      dragRef.current = { startX: event.clientX, startWidth };
      onResizeStart?.();

      const prevCursor = document.body.style.cursor;
      const prevUserSelect = document.body.style.userSelect;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (moveEvent: MouseEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const delta = drag.startX - moveEvent.clientX;
        onResize(clampRightSidebarWidthPx(drag.startWidth + delta));
      };

      const onUp = (upEvent: MouseEvent) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevUserSelect;

        const drag = dragRef.current;
        dragRef.current = null;
        if (drag) {
          const delta = drag.startX - upEvent.clientX;
          onResizeEnd?.(clampRightSidebarWidthPx(drag.startWidth + delta));
        }
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [disabled, onResize, onResizeEnd, onResizeStart],
  );

  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label="Изменить ширину панели"
      onMouseDown={handleMouseDown}
      sx={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 6,
        transform: 'translateX(-50%)',
        cursor: disabled ? 'default' : 'col-resize',
        zIndex: 2,
        opacity: disabled ? 0.35 : 0.65,
        transition: 'opacity 0.15s ease, background-color 0.15s ease',
        '&:hover': disabled
          ? undefined
          : {
              opacity: 1,
              bgcolor: 'rgba(255,255,255,0.18)',
            },
        '&::after': {
          content: '""',
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          width: 2,
          height: 48,
          borderRadius: 1,
          bgcolor: 'rgba(255,255,255,0.45)',
        },
      }}
    />
  );
}

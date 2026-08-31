import React from 'react';
import { Box, type SxProps, type Theme } from '@mui/material';

/**
 * Текст со shimmer, как «Thinking» в Cursor:
 * двойной слой (база + блик) и линейный проход по всей ширине строки.
 */
export default function ThinkingShimmerText({
  children,
  isDarkMode = false,
  fontSize = '0.9rem',
  fontWeight = 400,
  sx,
}: {
  children: React.ReactNode;
  isDarkMode?: boolean;
  fontSize?: string | number;
  fontWeight?: number | string;
  sx?: SxProps<Theme>;
}) {
  const dim = isDarkMode ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.38)';
  const mid = isDarkMode ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.62)';
  const bright = isDarkMode ? 'rgba(255,255,255,0.96)' : 'rgba(0,0,0,0.88)';

  const textSx = {
    fontSize,
    fontWeight,
    lineHeight: 1.35,
    letterSpacing: '0.01em',
    fontVariantNumeric: 'tabular-nums' as const,
    whiteSpace: 'nowrap' as const,
  };

  return (
    <Box
      component="span"
      className="cursor-thinking-shimmer"
      sx={{
        display: 'inline-grid',
        verticalAlign: 'baseline',
        ...textSx,
        ...sx,
      }}
    >
      <Box component="span" sx={{ gridArea: '1 / 1', color: dim }}>
        {children}
      </Box>
      <Box
        component="span"
        aria-hidden
        sx={{
          gridArea: '1 / 1',
          backgroundImage: `linear-gradient(
            90deg,
            ${dim} 0%,
            ${dim} 32%,
            ${mid} 42%,
            ${bright} 50%,
            ${mid} 58%,
            ${dim} 68%,
            ${dim} 100%
          )`,
          backgroundSize: '200% 100%',
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          color: 'transparent',
          WebkitTextFillColor: 'transparent',
          animation: 'cursorThinkingShimmer 2s linear infinite',
          willChange: 'background-position',
        }}
      >
        {children}
      </Box>
    </Box>
  );
}

import React from 'react';
import { Box, type SxProps, type Theme } from '@mui/material';

/**
 * Текст со shimmer, как «Thinking» в Cursor:
 * мягкая светлая полоса пробегает по приглушённой надписи.
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

  return (
    <Box
      component="span"
      className="cursor-thinking-shimmer"
      sx={{
        display: 'inline-block',
        fontSize,
        fontWeight,
        lineHeight: 1.35,
        letterSpacing: '0.01em',
        backgroundImage: `linear-gradient(
          100deg,
          ${dim} 0%,
          ${dim} 36%,
          ${mid} 46%,
          ${bright} 50%,
          ${mid} 54%,
          ${dim} 64%,
          ${dim} 100%
        )`,
        backgroundSize: '220% 100%',
        backgroundClip: 'text',
        WebkitBackgroundClip: 'text',
        color: 'transparent',
        WebkitTextFillColor: 'transparent',
        animation: 'cursorThinkingShimmer 1.7s ease-in-out infinite',
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

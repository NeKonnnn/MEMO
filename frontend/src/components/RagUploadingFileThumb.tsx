import React from 'react';
import { Box } from '@mui/material';
import {
  getInlineDocKind,
  getInlineDocThumbColor,
  InlineAttachUploadSpinner,
} from './InlineDocAttachmentChip';

interface RagUploadingFileThumbProps {
  filename: string;
  /** 32 — карточки агента; 24–28 — строки списка RAG. */
  size?: number;
  isDarkMode?: boolean;
  borderRadius?: number | string;
}

/** Цветной квадрат без символики + спиннер (состояние загрузки в RAG). */
export default function RagUploadingFileThumb({
  filename,
  size = 32,
  isDarkMode = false,
  borderRadius,
}: RagUploadingFileThumbProps) {
  const kind = getInlineDocKind(filename);
  const color = getInlineDocThumbColor(kind, isDarkMode);
  const resolvedRadius = borderRadius ?? (size >= 40 ? '8px' : 1);
  const spinnerSize = Math.max(14, Math.round(size * (20 / 44)));

  return (
    <Box
      sx={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      <Box
        sx={{
          width: size,
          height: size,
          borderRadius: resolvedRadius,
          bgcolor: color,
        }}
        aria-hidden
      />
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <InlineAttachUploadSpinner size={spinnerSize} />
      </Box>
    </Box>
  );
}

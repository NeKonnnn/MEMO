import React from 'react';
import { Box, Typography } from '@mui/material';
import type { ChatArtifact } from '../../types/artifacts';
import {
  isHtmlArtifactType,
  isMarkdownArtifactType,
  isMermaidArtifactType,
  isReactArtifactType,
  isSvgArtifactType,
} from '../../utils/artifacts';
import ArtifactHtmlPreview from './ArtifactHtmlPreview';
import ArtifactMarkdownPreview from './ArtifactMarkdownPreview';
import ArtifactMermaidPreview from './ArtifactMermaidPreview';
import ArtifactSvgPreview from './ArtifactSvgPreview';
import ArtifactReactPreview from './ArtifactReactPreview';

interface Props {
  artifact: ChatArtifact;
  isStreaming?: boolean;
}

export default function ArtifactPreview({ artifact, isStreaming = false }: Props) {
  const { type, content, closed } = artifact;

  if (!closed && isStreaming && !(content || '').trim()) {
    return (
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 240 }}>
        <Typography variant="body2" sx={{ color: '#374151', fontWeight: 500 }}>
          Генерация артефакта…
        </Typography>
      </Box>
    );
  }

  if (isHtmlArtifactType(type)) {
    return <ArtifactHtmlPreview content={content} isStreaming={isStreaming && !closed} />;
  }
  if (isSvgArtifactType(type)) {
    return <ArtifactSvgPreview content={content} />;
  }
  if (isMarkdownArtifactType(type)) {
    return <ArtifactMarkdownPreview content={content} />;
  }
  if (isMermaidArtifactType(type)) {
    // Недописанный mermaid при стриме — не парсим (ошибки раньше утекали в body).
    if (isStreaming && !closed) {
      return (
        <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 240 }}>
          <Typography variant="body2" sx={{ color: '#374151', fontWeight: 500 }}>
            Диаграмма генерируется…
          </Typography>
        </Box>
      );
    }
    return <ArtifactMermaidPreview content={content} />;
  }
  if (isReactArtifactType(type)) {
    return <ArtifactReactPreview content={content} />;
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Предпросмотр для типа «{type}» недоступен. Смотрите вкладку «Код».
      </Typography>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.5,
          borderRadius: 1,
          bgcolor: 'rgba(0,0,0,0.04)',
          overflow: 'auto',
          fontSize: '0.8rem',
          whiteSpace: 'pre-wrap',
        }}
      >
        {content}
      </Box>
    </Box>
  );
}

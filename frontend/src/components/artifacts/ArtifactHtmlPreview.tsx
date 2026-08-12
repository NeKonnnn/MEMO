import React, { useMemo } from 'react';
import { Box } from '@mui/material';
import {
  isGpbPresentationHtml,
} from '../../utils/presentationViewer';
import InlinePresentationViewer from '../InlinePresentationViewer';

function escapeForSrcDoc(html: string): string {
  return html.replace(/<\/script/gi, '<\\/script');
}

function buildGenericHtmlSrcDoc(rawHtml: string): string {
  const html = escapeForSrcDoc(rawHtml);
  const looksComplete =
    /<!doctype/i.test(html) || /<html[\s>]/i.test(html);
  if (looksComplete) {
    return html;
  }
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    html, body { margin: 0; padding: 12px; font-family: system-ui, sans-serif; }
  </style>
</head>
<body>
${html}
</body>
</html>`;
}

interface Props {
  content: string;
  isStreaming?: boolean;
}

export default function ArtifactHtmlPreview({ content, isStreaming = false }: Props) {
  // Только реальные GPB-слайды → presentation viewer.
  // Обычный HTML (графики, страницы) всегда в iframe внутри артефакта.
  const isPresentation = isGpbPresentationHtml(content);

  const srcDoc = useMemo(() => buildGenericHtmlSrcDoc(content || ''), [content]);

  if (isPresentation) {
    return (
      <Box sx={{ height: '100%', minHeight: 280 }}>
        <InlinePresentationViewer html={content} isStreaming={isStreaming} />
      </Box>
    );
  }

  return (
    <Box
      component="iframe"
      title="HTML artifact preview"
      sandbox="allow-scripts allow-same-origin allow-forms"
      srcDoc={srcDoc}
      sx={{
        width: '100%',
        height: '100%',
        minHeight: 320,
        border: 0,
        borderRadius: 1,
        bgcolor: '#fff',
      }}
    />
  );
}

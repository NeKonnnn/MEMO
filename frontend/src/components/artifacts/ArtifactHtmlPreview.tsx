import React, { useMemo } from 'react';
import { Box } from '@mui/material';
import {
  isGpbPresentationHtml,
  isGpbPresentationStreaming,
} from '../../utils/presentationViewer';
import { rewriteHtmlArtifactScriptsForOffline } from '../../utils/htmlArtifactScripts';
import { useCommittedContent } from '../../hooks/useCommittedContent';
import InlinePresentationViewer from '../InlinePresentationViewer';

function escapeForSrcDoc(html: string): string {
  return html.replace(/<\/script/gi, '<\\/script');
}

function buildGenericHtmlSrcDoc(rawHtml: string): string {
  const rewritten = rewriteHtmlArtifactScriptsForOffline(rawHtml || '');
  const html = escapeForSrcDoc(rewritten);
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
  // Во время стрима — chrome презентации сразу (спиннер), не сырой HTML/код.
  const isPresentation =
    isGpbPresentationHtml(content) ||
    (isStreaming && isGpbPresentationStreaming(content));

  // Chart.js/iframe: не пересоздаём документ на каждый токен.
  const committed = useCommittedContent(content || '', isStreaming, 500);
  const srcDoc = useMemo(() => buildGenericHtmlSrcDoc(committed), [committed]);

  if (isPresentation) {
    return (
      <Box sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <InlinePresentationViewer html={content} isStreaming={isStreaming} embedded />
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
        borderRadius: 0,
        bgcolor: '#fff',
        display: 'block',
      }}
    />
  );
}

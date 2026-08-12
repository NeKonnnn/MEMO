import React, { useMemo } from 'react';
import { Box } from '@mui/material';

interface Props {
  content: string;
}

export default function ArtifactSvgPreview({ content }: Props) {
  const srcDoc = useMemo(() => {
    const svg = (content || '').trim();
    if (!svg) return '';
    if (/<svg[\s>]/i.test(svg)) {
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>
        html,body{margin:0;padding:16px;display:flex;align-items:center;justify-content:center;min-height:100%;background:#fafafa}
        svg{max-width:100%;height:auto}
      </style></head><body>${svg}</body></html>`;
    }
    return `<!DOCTYPE html><html><body><pre>${svg.replace(/</g, '&lt;')}</pre></body></html>`;
  }, [content]);

  return (
    <Box
      component="iframe"
      title="SVG artifact preview"
      sandbox=""
      srcDoc={srcDoc}
      sx={{ width: '100%', height: '100%', minHeight: 280, border: 0, bgcolor: '#fafafa' }}
    />
  );
}

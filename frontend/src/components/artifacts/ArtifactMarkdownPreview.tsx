import React from 'react';
import { Box } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  content: string;
}

export default function ArtifactMarkdownPreview({ content }: Props) {
  return (
    <Box
      sx={{
        p: 2,
        height: '100%',
        overflow: 'auto',
        bgcolor: '#e8eaed',
        color: '#1f2937',
        '& h1, & h2, & h3': { mt: 1.5, mb: 1 },
        '& p': { mb: 1 },
        '& pre': {
          p: 1.5,
          borderRadius: 1,
          overflow: 'auto',
          bgcolor: 'rgba(255,255,255,0.85)',
        },
        '& code': { fontFamily: 'Consolas, monospace', fontSize: '0.85em' },
        '& table': { borderCollapse: 'collapse', width: '100%', mb: 1.5 },
        '& th, & td': { border: '1px solid rgba(0,0,0,0.12)', p: 0.75, textAlign: 'left' },
      }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content || ''}</ReactMarkdown>
    </Box>
  );
}

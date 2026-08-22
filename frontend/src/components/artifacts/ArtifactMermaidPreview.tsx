import React, { useEffect, useId, useRef, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import {
  prepareMermaidSourceForRender,
  repairMermaidSource,
  sanitizeMermaidSource,
  stripMermaidStyling,
} from '../../utils/artifacts';

interface Props {
  content: string;
}

const MERMAID_INIT = {
  startOnLoad: false,
  suppressErrorRendering: true,
  securityLevel: 'loose' as const,
  // Только theme base уважает themeVariables (pie1..N, plotColorPalette).
  // default/neutral подставляют свою палитру и игнорируют цвета пользователя.
  theme: 'base' as const,
};

let mermaidInitTheme: string | null = null;

async function getMermaid() {
  const mermaid = (await import('mermaid')).default;
  if (mermaidInitTheme !== MERMAID_INIT.theme) {
    mermaid.initialize(MERMAID_INIT);
    mermaidInitTheme = MERMAID_INIT.theme;
  }
  return mermaid;
}

function cleanupMermaidDomJunk(renderId: string) {
  try {
    document.getElementById(renderId)?.remove();
    document.getElementById(`d${renderId}`)?.remove();
    document.querySelectorAll('[id^="dmermaid-"]').forEach((n) => {
      const text = (n.textContent || '').toLowerCase();
      if (text.includes('error in text') || text.includes('syntax error')) {
        n.remove();
      }
    });
    document.querySelectorAll('body > svg').forEach((n) => {
      const text = (n.textContent || '').toLowerCase();
      if (text.includes('error in text') && text.includes('version')) {
        n.remove();
      }
    });
  } catch {
    /* ignore */
  }
}

function errorMessage(e: any): string {
  const msg = e?.str || e?.message || String(e) || 'Не удалось отрисовать диаграмму';
  return typeof msg === 'string' ? msg : 'Ошибка синтаксиса Mermaid';
}

async function tryRender(
  mermaid: any,
  renderId: string,
  code: string,
): Promise<string> {
  await mermaid.parse(code);
  const { svg } = await mermaid.render(renderId, code);
  return svg;
}

export default function ArtifactMermaidPreview({ content }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const reactId = useId().replace(/:/g, '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let renderId = `mermaid-${reactId}-pending`;
    const timer = window.setTimeout(() => {
      renderId = `mermaid-${reactId}-${Date.now()}`;

      const run = async () => {
        setLoading(true);
        setError(null);
        const el = hostRef.current;
        if (!el) return;
        el.innerHTML = '';

        const variants = [
          prepareMermaidSourceForRender(content),
          sanitizeMermaidSource(content),
          repairMermaidSource(content),
          stripMermaidStyling(content),
        ].filter((v, i, arr) => v && arr.indexOf(v) === i);

        if (!variants.length) {
          setLoading(false);
          return;
        }

        try {
          const mermaid = await getMermaid();
          let lastErr: any = null;
          let svg: string | null = null;

          for (let i = 0; i < variants.length; i++) {
            const id = `${renderId}-${i}`;
            try {
              svg = await tryRender(mermaid, id, variants[i]);
              cleanupMermaidDomJunk(id);
              break;
            } catch (e) {
              lastErr = e;
              cleanupMermaidDomJunk(id);
            }
          }

          if (cancelled) return;

          if (svg) {
            el.innerHTML = svg;
            setError(null);
          } else {
            setError(
              'Не удалось отрисовать диаграмму Mermaid — синтаксис исходника невалиден.\n' +
                'Откройте вкладку «Код» и проверьте исходник.\n' +
                'Частые причины: style с CSS (text-align/font-size), style с кириллическими id, ' +
                'незакрытые кавычки, style у pie/xychart.\n\n' +
                errorMessage(lastErr),
            );
          }
        } catch (e: any) {
          cleanupMermaidDomJunk(renderId);
          if (!cancelled) setError(errorMessage(e));
        } finally {
          cleanupMermaidDomJunk(renderId);
          if (!cancelled) setLoading(false);
        }
      };

      void run();
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      cleanupMermaidDomJunk(renderId);
    };
  }, [content, reactId]);

  useEffect(() => {
    cleanupMermaidDomJunk(`mermaid-${reactId}-boot`);
  }, [reactId]);

  return (
    <Box
      sx={{
        p: 2,
        height: '100%',
        minHeight: '100%',
        overflow: 'auto',
        position: 'relative',
        boxSizing: 'border-box',
        bgcolor: '#e8eaed',
        color: '#1f2937',
      }}
    >
      {loading ? (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 1.5,
            minHeight: 240,
            height: '100%',
            py: 4,
          }}
        >
          <CircularProgress size={36} thickness={4} sx={{ color: '#2355D7 !important' }} />
          <Box
            component="span"
            sx={{
              display: 'inline-block',
              fontSize: 13,
              fontWeight: 600,
              lineHeight: 1.4,
              px: 2,
              py: 0.75,
              borderRadius: 1.5,
              bgcolor: '#ffffff',
              color: '#111827 !important',
              boxShadow: '0 1px 4px rgba(0,0,0,0.14)',
              border: '1px solid rgba(0,0,0,0.08)',
            }}
          >
            Генерация схемы…
          </Box>
        </Box>
      ) : null}
      {error ? (
        <Typography
          variant="body2"
          sx={{
            whiteSpace: 'pre-wrap',
            color: '#991b1b',
            bgcolor: 'rgba(255,255,255,0.95)',
            borderRadius: 1.5,
            p: 1.5,
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          }}
        >
          {error}
        </Typography>
      ) : null}
      <Box
        ref={hostRef}
        sx={{
          display: loading || error ? 'none' : 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: 240,
          height: '100%',
          '& svg': { maxWidth: '100%', maxHeight: '100%', height: 'auto' },
        }}
      />
    </Box>
  );
}

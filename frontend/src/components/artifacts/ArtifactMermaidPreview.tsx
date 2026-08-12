import React, { useEffect, useId, useRef, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import {
  repairMermaidSource,
  sanitizeMermaidSource,
  stripMermaidStyling,
} from '../../utils/artifacts';

interface Props {
  content: string;
}

let mermaidInitDone = false;

async function getMermaid() {
  const mermaid = (await import('mermaid')).default;
  if (!mermaidInitDone) {
    mermaid.initialize({
      startOnLoad: false,
      // Иначе при Syntax error SVG «error in text / version X» уезжает в <body>
      // и ломает прокрутку всей рабочей зоны чата.
      suppressErrorRendering: true,
      securityLevel: 'loose',
      theme: 'neutral',
    });
    mermaidInitDone = true;
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

async function tryRender(mermaid: any, renderId: string, code: string): Promise<string> {
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

        // Три попытки: как есть → починка битых style → без style/class вовсе
        const variants = [
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
    <Box sx={{ p: 2, height: '100%', minHeight: '100%', overflow: 'auto', position: 'relative', boxSizing: 'border-box' }}>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 240, py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      ) : null}
      {error ? (
        <Typography color="error" variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
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

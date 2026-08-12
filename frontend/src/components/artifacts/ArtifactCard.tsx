import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  Collapse,
  IconButton,
  Snackbar,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ContentCopy as CopyIcon,
  GetApp as DownloadIcon,
  Code as CodeIcon,
  ExpandLess as ExpandLessIcon,
  OpenInNew as OpenInNewIcon,
} from '@mui/icons-material';
import Editor from '@monaco-editor/react';
import type { ChatArtifact } from '../../types/artifacts';
import { artifactTypeLabel, guessCodeLanguage } from '../../utils/artifacts';
import { openArtifactViewer, sourceLabelForArtifactType } from '../../utils/artifactViewer';
import ArtifactPreview from './ArtifactPreview';

// Тот же номинальный аспект, что у InlinePresentationViewer (слайд 297×167mm).
const SLIDE_ASPECT = 297 / 167;

interface Props {
  artifact: ChatArtifact;
  isStreaming?: boolean;
  /** Совместимость с MessageRenderer. */
  autoOpen?: boolean;
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function extensionForType(type: string): string {
  const lang = guessCodeLanguage(type);
  if (lang === 'html') return 'html';
  if (lang === 'xml') return 'svg';
  if (lang === 'markdown') return 'md';
  if (lang === 'mermaid') return 'mmd';
  if (lang === 'tsx') return 'tsx';
  return 'txt';
}

/**
 * Встроенный viewer артефакта в сообщении.
 * UX как у InlinePresentationViewer: превью + «Показать …» / «Открыть в новой вкладке».
 */
export default function ArtifactCard({ artifact, isStreaming = false }: Props) {
  const [showSource, setShowSource] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [localContent, setLocalContent] = useState(artifact.content || '');
  const [copyOk, setCopyOk] = useState(false);
  const previewHostRef = React.useRef<HTMLDivElement>(null);
  const editorPath = useMemo(
    () => `artifact://${artifact.id || artifact.identifier || 'src'}.${extensionForType(artifact.type)}`,
    [artifact.id, artifact.identifier, artifact.type],
  );

  useEffect(() => {
    setLocalContent(artifact.content || '');
  }, [artifact.id, artifact.content]);

  // Один раз при окончании стрима обновляем превью и закрываем исходник.
  const wasStreamingRef = React.useRef(isStreaming);
  useEffect(() => {
    const was = wasStreamingRef.current;
    wasStreamingRef.current = isStreaming;
    if (was && !isStreaming && artifact.closed) {
      setShowSource(false);
      setPreviewKey((k) => k + 1);
    }
  }, [isStreaming, artifact.closed]);

  const language = useMemo(() => guessCodeLanguage(artifact.type), [artifact.type]);
  const pending = isStreaming && !artifact.closed;
  const sourceLabel = sourceLabelForArtifactType(artifact.type);

  const displayArtifact = useMemo(
    () => ({
      ...artifact,
      content: localContent,
    }),
    [artifact, localContent],
  );

  const statusLabel = (() => {
    const kind = artifactTypeLabel(artifact.type);
    if (pending) return `${artifact.title || kind} · генерация…`;
    return artifact.title || kind;
  })();

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(localContent || '');
      setCopyOk(true);
    } catch {
      /* ignore */
    }
  }, [localContent]);

  const handleDownload = useCallback(() => {
    const safe = (artifact.identifier || 'artifact').replace(/[^\w.-]+/g, '_');
    downloadText(`${safe}.${extensionForType(artifact.type)}`, localContent || '');
  }, [artifact.identifier, artifact.type, localContent]);

  const handleOpenExternal = useCallback(() => {
    const title = artifact.title || artifactTypeLabel(artifact.type);
    // Берём уже отрисованный SVG из превью — то же, что видно в чате
    const liveSvg = previewHostRef.current?.querySelector('svg');
    if (liveSvg) {
      void openArtifactViewer({
        type: 'image/svg+xml',
        content: liveSvg.outerHTML,
        title,
      }).catch((e) => console.error('Failed to open artifact viewer:', e));
      return;
    }
    void openArtifactViewer({
      type: artifact.type,
      content: localContent || artifact.content || '',
      title,
    }).catch((e) => {
      console.error('Failed to open artifact viewer:', e);
    });
  }, [artifact.type, artifact.title, artifact.content, localContent]);

  const typeLabel = artifactTypeLabel(artifact.type);
  const showTypeLabel =
    Boolean(typeLabel) &&
    !(artifact.title || '').trim().toLowerCase().includes(typeLabel.toLowerCase());

  const codeLineCount = Math.max(1, (localContent || '').split('\n').length);
  const editorHeight = Math.min(480, Math.max(200, Math.min(codeLineCount, 22) * 22 + 18));

  return (
    <Box
      sx={{
        my: 2,
        borderRadius: 2,
        overflow: 'hidden',
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          px: 1.5,
          py: 0.75,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: (t) => (t.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)'),
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
          {pending ? (
            <CircularProgress size={14} thickness={5} sx={{ color: 'primary.main', flexShrink: 0 }} />
          ) : null}
          <Typography
            variant="caption"
            sx={{ fontWeight: 600, letterSpacing: 0.02, overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {statusLabel}
          </Typography>
          {showTypeLabel ? (
            <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
              {typeLabel}
            </Typography>
          ) : null}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          {!pending ? (
            <Tooltip title={showSource ? `Скрыть ${sourceLabel}` : `Показать ${sourceLabel}`}>
              <IconButton size="small" onClick={() => setShowSource((v) => !v)}>
                {showSource ? <ExpandLessIcon fontSize="small" /> : <CodeIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          ) : null}
          {!pending ? (
            <Tooltip title="Открыть в новой вкладке">
              <IconButton size="small" onClick={handleOpenExternal}>
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          ) : null}
        </Box>
      </Box>

      {/* Размер как у InlinePresentationViewer; светлый фон — чтобы подписи диаграмм были читаемы */}
      <Box
        sx={{
          width: '100%',
          maxHeight: 'min(88vh, 880px)',
          minHeight: 320,
          position: 'relative',
          bgcolor: '#e8eaed',
          pt: `calc(100% / ${SLIDE_ASPECT})`,
          pb: '48px',
          overflow: 'hidden',
        }}
      >
        <Box
          ref={previewHostRef}
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            overflow: 'auto',
          }}
        >
          <Box key={previewKey} sx={{ width: '100%', height: '100%', minHeight: 280 }}>
            <ArtifactPreview artifact={displayArtifact} isStreaming={pending} />
          </Box>
        </Box>
      </Box>

      {!pending ? (
        <Collapse in={showSource} unmountOnExit timeout={180}>
          <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
            <Box
              sx={{
                backgroundColor: '#1e1e1e',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  px: 2,
                  py: 1,
                  backgroundColor: '#2d2d30',
                  borderBottom: '1px solid #3e3e42',
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    color: '#cccccc',
                    fontFamily: 'monospace',
                    textTransform: 'uppercase',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                  }}
                >
                  {sourceLabel}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                  <Tooltip title={copyOk ? '✓ Скопировано!' : 'Копировать код'}>
                    <IconButton
                      size="small"
                      onClick={handleCopy}
                      sx={{
                        color: '#cccccc',
                        '&:hover': { backgroundColor: 'rgba(255,255,255,0.1)', color: '#4ec9b0' },
                      }}
                    >
                      <CopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Скачать файл">
                    <IconButton
                      size="small"
                      onClick={handleDownload}
                      sx={{
                        color: '#cccccc',
                        '&:hover': { backgroundColor: 'rgba(255,255,255,0.1)', color: '#4ec9b0' },
                      }}
                    >
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
              <Editor
                height={`${editorHeight}px`}
                language={language}
                value={localContent}
                path={editorPath}
                theme="vs-dark"
                loading={
                  <Box sx={{ p: 2, color: '#aaa', fontSize: 13 }}>Загрузка редактора…</Box>
                }
                onMount={(editor) => {
                  requestAnimationFrame(() => {
                    editor.layout();
                    requestAnimationFrame(() => editor.layout());
                  });
                }}
                options={{
                  readOnly: false,
                  minimap: { enabled: false },
                  fontSize: 13,
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                }}
                onChange={(value) => setLocalContent(value ?? '')}
              />
            </Box>
          </Box>
        </Collapse>
      ) : null}

      <Snackbar open={copyOk} autoHideDuration={1800} onClose={() => setCopyOk(false)}>
        <Alert severity="success" onClose={() => setCopyOk(false)} sx={{ width: '100%' }}>
          Скопировано
        </Alert>
      </Snackbar>
    </Box>
  );
}

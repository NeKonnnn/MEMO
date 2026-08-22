import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, CircularProgress, IconButton, Tooltip, Typography, Collapse } from '@mui/material';
import {
  OpenInNew as OpenInNewIcon,
  Code as CodeIcon,
  ExpandLess as ExpandLessIcon,
} from '@mui/icons-material';
import {
  getStablePresentationSnapshot,
  openPresentationViewer,
} from '../utils/presentationViewer';

/** Номинальный размер слайда GPB (как в presentation-viewer.html). */
const SLIDE_W_MM = 297;
const SLIDE_H_MM = 167;
const SLIDE_ASPECT = SLIDE_W_MM / SLIDE_H_MM;

function stripEmbeddedScripts(html: string): string {
  return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
}

function escapeForScriptPlain(html: string): string {
  return html.replace(/<\/script/gi, '<\\/script');
}

/**
 * Self-contained srcdoc.
 * Слайд всегда в номинальном размере 297×167mm, в контейнер вписывается
 * через transform: scale — без растягивания width/height (иначе ломается вёрстка GPB).
 */
export function buildInlinePresentationViewerSrcDoc(rawHtml: string): string {
  const html = escapeForScriptPlain(stripEmbeddedScripts(rawHtml));
  const publicBase = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  const pptxScript = `${publicBase}/static/dom-to-pptx.bundle.js`;

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="${pptxScript}"></script>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: #e8eaed;
      font-family: 'Segoe UI', sans-serif;
      overflow: hidden;
    }
    .root {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      padding: 8px;
      gap: 6px;
    }
    #stageWrap {
      flex: 1 1 auto;
      min-height: 0;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      position: relative;
    }
    #stageScaler {
      position: relative;
      flex-shrink: 0;
    }
    #viewer {
      width: ${SLIDE_W_MM}mm;
      height: ${SLIDE_H_MM}mm;
      background: white;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
      position: relative;
      overflow: hidden;
      border-radius: 4px;
      transform-origin: top left;
    }
    #viewer:empty::after {
      content: 'Загрузка...';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #999;
      font-size: 13px;
    }
    .toolbar {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: center;
      flex-shrink: 0;
    }
    button {
      padding: 7px 14px;
      background: #2355D7;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      line-height: 1.2;
    }
    button:disabled {
      background: #9ca3af;
      cursor: not-allowed;
    }
    button.secondary {
      background: #fff;
      color: #2355D7;
      border: 1px solid #2355D7;
    }
    #counter { font-size: 11px; color: #666; flex-shrink: 0; }
    #error {
      display: none;
      width: 100%;
      padding: 8px 10px;
      background: #fee2e2;
      color: #991b1b;
      border-radius: 6px;
      font-size: 12px;
      flex-shrink: 0;
    }
    iframe#frame { display: none; }
  </style>
</head>
<body>
  <div class="root">
    <div id="error"></div>
    <div id="stageWrap">
      <div id="stageScaler">
        <div id="viewer"></div>
      </div>
    </div>
    <div class="toolbar">
      <button type="button" class="secondary" id="prevBtn" disabled>← Назад</button>
      <button type="button" class="secondary" id="nextBtn" disabled>Вперёд →</button>
      <button type="button" id="exportBtn" disabled>Скачать PPTX</button>
      <span id="counter">—</span>
    </div>
  </div>
  <iframe id="frame" title="presentation-source"></iframe>
  <script id="src" type="text/plain">${html}</script>
  <script>
    var slides = [];
    var current = 0;
    var exporting = false;
    var slideStylesInjected = false;

    function showError(msg) {
      var el = document.getElementById('error');
      el.style.display = 'block';
      el.textContent = msg;
    }

    function stripEmbeddedScripts(h) {
      return h.replace(/<script[^>]*>[\\s\\S]*?<\\/script>/gi, '');
    }

    function fitStage() {
      var wrap = document.getElementById('stageWrap');
      var scaler = document.getElementById('stageScaler');
      var viewer = document.getElementById('viewer');
      if (!wrap || !scaler || !viewer) return;
      var natW = viewer.offsetWidth;
      var natH = viewer.offsetHeight;
      if (!natW || !natH) return;
      var availW = wrap.clientWidth;
      var availH = wrap.clientHeight;
      if (!availW || !availH) return;
      var s = Math.min(availW / natW, availH / natH);
      if (s > 1) s = 1;
      viewer.style.transform = 'scale(' + s + ')';
      scaler.style.width = (natW * s) + 'px';
      scaler.style.height = (natH * s) + 'px';
    }

    function init() {
      var raw = document.getElementById('src').textContent || '';
      var html = stripEmbeddedScripts(raw.trim());
      if (!html) {
        showError('HTML презентации пуст.');
        return;
      }
      var frame = document.getElementById('frame');
      frame.srcdoc = html;
      frame.onload = function () {
        try {
          var doc = frame.contentDocument;
          slides = Array.from(doc.querySelectorAll('.slide'));
          if (!slides.length) {
            showError('В HTML не найдены слайды с классом .slide');
            return;
          }
          if (!slideStylesInjected) {
            doc.querySelectorAll('style').forEach(function (s) {
              var ns = document.createElement('style');
              ns.textContent = s.textContent;
              document.head.appendChild(ns);
            });
            slideStylesInjected = true;
          }
          show(0);
          document.getElementById('exportBtn').disabled = false;
          document.getElementById('prevBtn').disabled = false;
          document.getElementById('nextBtn').disabled = false;
          fitStage();
          requestAnimationFrame(fitStage);
        } catch (e) {
          showError('Ошибка загрузки HTML презентации');
          console.error(e);
        }
      };
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(fitStage).observe(document.getElementById('stageWrap'));
      }
      window.addEventListener('resize', fitStage);
    }

    function show(i) {
      if (i < 0 || i >= slides.length) return;
      current = i;
      var viewer = document.getElementById('viewer');
      var clone = slides[i].cloneNode(true);
      clone.style.position = 'absolute';
      clone.style.top = '0';
      clone.style.left = '0';
      clone.style.margin = '0';
      clone.style.width = '${SLIDE_W_MM}mm';
      clone.style.height = '${SLIDE_H_MM}mm';
      clone.style.maxWidth = 'none';
      clone.style.maxHeight = 'none';
      clone.style.boxSizing = 'border-box';
      clone.style.overflow = 'hidden';
      viewer.innerHTML = '';
      viewer.appendChild(clone);
      document.getElementById('counter').textContent = (i + 1) + ' / ' + slides.length;
      document.getElementById('prevBtn').disabled = i <= 0;
      document.getElementById('nextBtn').disabled = i >= slides.length - 1;
      fitStage();
    }

    document.getElementById('prevBtn').addEventListener('click', function () { show(current - 1); });
    document.getElementById('nextBtn').addEventListener('click', function () { show(current + 1); });
    document.getElementById('stageWrap').addEventListener('wheel', function (e) {
      e.preventDefault();
      show(current + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });

    async function exportPptx() {
      if (exporting || !slides.length) return;
      if (typeof domToPptx === 'undefined' || !domToPptx.exportToPptx) {
        showError('Библиотека dom-to-pptx не загружена.');
        return;
      }
      exporting = true;
      var btn = document.getElementById('exportBtn');
      btn.disabled = true;
      btn.textContent = 'Экспорт...';
      var wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;left:-9999px;top:0;';
      document.body.appendChild(wrap);
      var elems = slides.map(function (s) {
        var d = document.createElement('div');
        d.style.cssText = 'width:${SLIDE_W_MM}mm;height:${SLIDE_H_MM}mm;overflow:hidden;position:relative;';
        var c = s.cloneNode(true);
        c.style.cssText = 'width:100%;height:100%;margin:0;font-family:"Cera CY",sans-serif;';
        d.appendChild(c);
        wrap.appendChild(d);
        return d;
      });
      try {
        await domToPptx.exportToPptx(elems, {
          fileName: 'presentation.pptx',
          svgAsVector: true,
          autoEmbedFonts: false,
        });
      } catch (e) {
        showError('Ошибка экспорта в PPTX: ' + (e && e.message ? e.message : String(e)));
        console.error(e);
      } finally {
        wrap.remove();
        exporting = false;
        btn.disabled = false;
        btn.textContent = 'Скачать PPTX';
      }
    }

    document.getElementById('exportBtn').addEventListener('click', exportPptx);
    init();
  </script>
</body>
</html>`;
}

interface InlinePresentationViewerProps {
  html: string;
  sourceSlot?: React.ReactNode;
  /** Пока модель стримит HTML — не пересоздаём iframe на каждый токен. */
  isStreaming?: boolean;
  /**
   * Внутри ArtifactCard: без своей рамки/шапки («Презентация»),
   * иначе двойной chrome поверх заголовка артефакта.
   */
  embedded?: boolean;
}

/**
 * Встроенный просмотр GPB-презентации в ответе чата.
 * При стриме: спиннер + послайдовый показ без мерцания.
 */
export default function InlinePresentationViewer({
  html,
  sourceSlot,
  isStreaming = false,
  embedded = false,
}: InlinePresentationViewerProps) {
  const [showSource, setShowSource] = useState(false);
  const [committedHtml, setCommittedHtml] = useState<string | null>(null);
  const [readyCount, setReadyCount] = useState(0);
  const [startedCount, setStartedCount] = useState(0);
  const [pending, setPending] = useState(isStreaming);
  const lastReadyRef = useRef(-1);

  useEffect(() => {
    const snap = getStablePresentationSnapshot(html, isStreaming);

    if (!isStreaming) {
      if (snap.html) {
        setCommittedHtml(snap.html);
        setReadyCount(snap.readyCount);
        setStartedCount(snap.startedCount);
        lastReadyRef.current = snap.readyCount;
      }
      setPending(false);
      return;
    }

    setStartedCount(snap.startedCount);
    setPending(true);

    // Обновляем iframe только когда вырос readyCount (зафиксирован новый слайд).
    if (snap.html && snap.readyCount > lastReadyRef.current) {
      lastReadyRef.current = snap.readyCount;
      setCommittedHtml(snap.html);
      setReadyCount(snap.readyCount);
    }
  }, [html, isStreaming]);

  const srcDoc = useMemo(
    () => (committedHtml ? buildInlinePresentationViewerSrcDoc(committedHtml) : null),
    [committedHtml]
  );

  const showLoader = pending && !srcDoc;
  const showGeneratingBadge = pending && !!srcDoc;
  const showMissingSlides = !pending && !srcDoc;

  const statusLabel = (() => {
    if (showMissingSlides) return 'Презентация · нет слайдов';
    if (!pending) return 'Презентация';
    if (readyCount > 0) {
      return `Презентация · готово ${readyCount}${startedCount > readyCount ? ` · слайд ${readyCount + 1}…` : '…'}`;
    }
    if (startedCount > 0) return `Презентация · слайд ${startedCount}…`;
    return 'Презентация · генерация…';
  })();

  const handleOpenExternal = () => {
    try {
      openPresentationViewer(html);
    } catch (e) {
      console.error('Failed to open presentation viewer:', e);
    }
  };

  const stage = (
    <Box
      sx={
        embedded
          ? {
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              bgcolor: '#e8eaed',
              overflow: 'hidden',
            }
          : {
              width: '100%',
              maxHeight: 'min(88vh, 880px)',
              minHeight: 320,
              position: 'relative',
              bgcolor: '#e8eaed',
              pt: `calc(100% / ${SLIDE_ASPECT})`,
              pb: '48px',
              overflow: 'hidden',
            }
      }
    >
      {srcDoc ? (
        <Box
          component="iframe"
          key={`pptx-ready-${readyCount}-${pending ? 's' : 'done'}`}
          title="Просмотр презентации"
          srcDoc={srcDoc}
          sandbox="allow-scripts allow-same-origin allow-downloads"
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            border: 0,
            display: 'block',
          }}
        />
      ) : null}

      {showLoader ? (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1.5,
            bgcolor: '#e8eaed',
          }}
        >
          <CircularProgress size={36} thickness={4} sx={{ color: '#2355D7' }} />
          <Typography variant="body2" sx={{ color: '#111', fontSize: 13 }}>
            {startedCount > 0
              ? `Генерируется слайд ${startedCount}…`
              : 'Генерируется презентация…'}
          </Typography>
        </Box>
      ) : null}

      {showMissingSlides ? (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            px: 2,
            bgcolor: '#e8eaed',
          }}
        >
          <Typography variant="body2" sx={{ color: '#991b1b', fontSize: 13, textAlign: 'center' }}>
            В HTML нет элементов с классом <code>.slide</code>
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 420 }}>
            Каждый слайд должен быть обёрнут в <code>{'<div class="slide">'}</code> — не путать с{' '}
            <code>slide-title</code> / <code>content-zone</code>.
          </Typography>
        </Box>
      ) : null}

      {showGeneratingBadge ? (
        <Box
          sx={{
            position: 'absolute',
            left: 12,
            bottom: embedded ? 12 : 56,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.25,
            py: 0.75,
            borderRadius: 1.5,
            bgcolor: 'rgba(255,255,255,0.92)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
            pointerEvents: 'none',
          }}
        >
          <CircularProgress size={14} thickness={5} sx={{ color: '#2355D7' }} />
          <Typography variant="caption" sx={{ color: '#111', fontWeight: 500 }}>
            Генерируется слайд {Math.max(startedCount, readyCount + 1)}…
          </Typography>
        </Box>
      ) : null}
    </Box>
  );

  if (embedded) {
    return (
      <Box sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        {stage}
      </Box>
    );
  }

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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          {pending ? (
            <CircularProgress size={14} thickness={5} sx={{ color: 'primary.main', flexShrink: 0 }} />
          ) : null}
          <Typography
            variant="caption"
            sx={{ fontWeight: 600, letterSpacing: 0.02, overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {statusLabel}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
          {sourceSlot && !pending ? (
            <Tooltip title={showSource ? 'Скрыть HTML' : 'Показать HTML'}>
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

      {stage}

      {sourceSlot && !pending ? (
        <Collapse in={showSource} unmountOnExit timeout={180}>
          <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>{sourceSlot}</Box>
        </Collapse>
      ) : null}
    </Box>
  );
}
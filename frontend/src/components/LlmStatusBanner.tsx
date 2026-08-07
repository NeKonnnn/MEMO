import React, { useEffect, useRef, useState } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { getApiUrl } from '../config/api';
import { getSettings, initSettings } from '../settings';
import { TOP_ERROR_BANNER_AUTO_DISMISS_MS } from './TopErrorBanner';

/**
 * Плашка сверху (как в Qwen UI), если бэкенд сообщает, что до LLM (llm-svc) достучаться нельзя.
 * URL сервиса моделей фронт не знает — только GET /api/llm/status.
 */
export default function LlmStatusBanner() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const lastPollTsRef = useRef<number | null>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    let cancelled = false;

    const startPolling = async () => {
      let settings;
      try {
        settings = getSettings();
      } catch {
        try {
          settings = await initSettings();
        } catch {
          return;
        }
      }
      if (cancelled) return;
      const pollIntervalSeconds = settings.app.llmStatusPollSeconds;
      const tracePollEnabled = settings.app.llmStatusPollTrace === true;

      const poll = async () => {
        if (tracePollEnabled) {
          const now = Date.now();
          const prev = lastPollTsRef.current;
          const deltaSec = prev ? ((now - prev) / 1000).toFixed(2) : 'first';
          lastPollTsRef.current = now;
          console.info(`[LLM_STATUS_POLL] /api/llm/status tick interval=${pollIntervalSeconds}s delta=${deltaSec}s`);
        }
        try {
          const res = await fetch(getApiUrl('/api/llm/status'));
          if (!res.ok) return;
          const data = await res.json();
          if (data.use_llm_svc === true && data.connected === false) {
            setOpen(!dismissed);
            setMessage(
              typeof data.message === 'string' && data.message.trim()
                ? data.message
                : 'Подключиться к LLM не удалось. Проверьте сервис моделей и конфигурацию на сервере.'
            );
          } else {
            setOpen(false);
            setDismissed(false);
            setMessage('');
          }
        } catch {
          setOpen(false);
        }
      };

      void poll();
      interval = setInterval(poll, pollIntervalSeconds * 1000);
    };

    void startPolling();
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [dismissed]);

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => {
      setOpen(false);
      setDismissed(true);
    }, TOP_ERROR_BANNER_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [open, message]);

  if (!open) return null;

  return (
    <Box
      role="alert"
      sx={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: (theme) => theme.zIndex.snackbar + 2,
        maxWidth: 'min(720px, calc(100vw - 24px))',
        px: 2,
        py: 1.25,
        borderRadius: 1,
        border: '2px solid',
        borderColor: 'error.main',
        bgcolor: (theme) =>
          theme.palette.mode === 'dark' ? 'rgba(183, 28, 28, 0.25)' : 'rgba(211, 47, 47, 0.08)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Typography variant="body2" color="error" sx={{ fontWeight: 600, textAlign: 'center', flex: 1 }}>
          {message}
        </Typography>
        <IconButton
          size="small"
          aria-label="Закрыть уведомление о подключении к LLM"
          onClick={() => {
            setOpen(false);
            setDismissed(true);
          }}
          sx={{
            color: 'error.main',
            mt: -0.5,
            mr: -0.5,
            '&:hover': { bgcolor: 'rgba(211, 47, 47, 0.12)' },
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, Container, Typography, Alert } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

function readSsoTicket(searchParams: URLSearchParams): string | null {
  const fromQuery = searchParams.get('ticket');
  if (fromQuery) {
    return fromQuery;
  }
  const hashRaw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  if (!hashRaw) {
    return null;
  }
  return new URLSearchParams(hashRaw).get('ticket');
}

export default function SsoCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { completeSsoLogin } = useAuth();
  const [error, setError] = useState('');
  const exchangeStartedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const ssoError = searchParams.get('sso_error');
      if (ssoError) {
        if (!cancelled) {
          setError(ssoError);
        }
        return;
      }

      const ticket = readSsoTicket(searchParams);
      if (!ticket) {
        if (!cancelled) {
          setError('Отсутствует ticket SSO');
        }
        return;
      }

      const exchangeSessionKey = `sso_ticket_exchange:${ticket}`;
      if (sessionStorage.getItem(exchangeSessionKey) === 'done') {
        if (!cancelled) {
          navigate('/', { replace: true });
        }
        return;
      }
      if (exchangeStartedRef.current) {
        return;
      }
      exchangeStartedRef.current = true;

      try {
        await completeSsoLogin(ticket);
        sessionStorage.setItem(exchangeSessionKey, 'done');
        if (!cancelled) {
          navigate('/', { replace: true });
        }
      } catch (err: unknown) {
        if (cancelled) return;
        if (axios.isAxiosError(err)) {
          const detail = err.response?.data?.detail;
          setError(typeof detail === 'string' ? detail : 'Не удалось завершить вход через SSO');
        } else if (err instanceof Error) {
          setError(err.message);
        } else {
          setError('Не удалось завершить вход через SSO');
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [completeSsoLogin, navigate, searchParams]);

  return (
    <Container maxWidth="sm">
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
        }}
      >
        {error ? (
          <>
            <Alert severity="error" sx={{ width: '100%' }}>
              {error}
            </Alert>
            <Typography
              component="button"
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              sx={{
                border: 'none',
                background: 'none',
                color: 'primary.main',
                cursor: 'pointer',
                textDecoration: 'underline',
                font: 'inherit',
              }}
            >
              Вернуться на страницу входа
            </Typography>
          </>
        ) : (
          <>
            <CircularProgress />
            <Typography variant="body1">Завершение входа через SSO…</Typography>
          </>
        )}
      </Box>
    </Container>
  );
}

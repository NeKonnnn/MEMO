import React from 'react';
import { Box, IconButton, Typography, useTheme } from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';

/**
 * Подробности релиза AstraChat 1.0.
 * Нужен как полноценный React-маршрут: `serve -s` / SPA иначе отдают пустой layout
 * на URL вида /docs/astrachat-release-1.0(.html).
 */
export default function ReleaseNotesPage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const isDarkMode = theme.palette.mode === 'dark';
  const fg = isDarkMode ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.85)';
  const muted = isDarkMode ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
  const title = isDarkMode ? '#ffffff' : '#111';
  const border = isDarkMode ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.12)';

  return (
    <Box
      sx={{
        flex: 1,
        overflow: 'auto',
        bgcolor: isDarkMode ? '#121212' : '#fafafa',
        color: fg,
      }}
    >
      <Box sx={{ maxWidth: 720, mx: 'auto', px: { xs: 2.5, sm: 3 }, py: { xs: 3, sm: 5 } }}>
        <Box
          component="button"
          type="button"
          onClick={() => navigate('/')}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            mb: 3,
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            color: isDarkMode ? '#90caf9' : '#1976d2',
            font: 'inherit',
            fontSize: '0.9375rem',
            p: 0,
            '&:hover': { textDecoration: 'underline' },
          }}
        >
          <ArrowBackIcon sx={{ fontSize: 18 }} />
          Вернуться в AstraChat
        </Box>

        <Typography
          component="h1"
          sx={{ fontSize: '1.75rem', fontWeight: 700, color: title, mb: 1, lineHeight: 1.25 }}
        >
          Релиз версии 1.0 AstraChat
        </Typography>
        <Typography sx={{ color: muted, fontSize: '0.9rem', mb: 2.5 }}>23 июня, 2026</Typography>

        <Typography sx={{ fontSize: '0.975rem', lineHeight: 1.55, mb: 2.5 }}>
          Первый полноценный релиз корпоративного ассистента AstraChat: единый чат с моделями,
          агентами, проектами, RAG и безопасной авторизацией в контуре банка.
        </Typography>

        <Box sx={{ borderTop: `1px solid ${border}`, my: 2.5 }} />

        <Box
          sx={{
            fontSize: '0.95rem',
            lineHeight: 1.55,
            '& h2': {
              fontSize: '1.1rem',
              fontWeight: 700,
              color: title,
              mt: 2.5,
              mb: 1,
            },
            '& ul': { m: 0, pl: 2.5 },
            '& li': { mb: 0.5 },
          }}
        >
          <Typography component="h2">Авторизация</Typography>
          <Box component="ul">
            <li>Добавлена авторизация по LDAP</li>
            <li>Добавлена авторизация по SSO (Keycloak)</li>
            <li>Поддержка ролей и политик доступа к агентам</li>
          </Box>

          <Typography component="h2">Чат</Typography>
          <Box component="ul">
            <li>Настроена интеграция с LLM-моделями домена CORSUR</li>
            <li>Настроена интеграция с LLM-моделями домена PHOENIX</li>
            <li>Режимы обычного и проектного чата, ветвление диалогов</li>
            <li>Экспорт ответов в PDF и Word с сохранением разметки и таблиц</li>
          </Box>

          <Typography component="h2">Файлы</Typography>
          <Box component="ul">
            <li>
              Прикрепление текстовых файлов (pdf, doc, docx, xlsx, txt) через кнопку «+» в окне
              ввода сообщения
            </li>
            <li>Отдельный экспорт markdown-таблиц в Excel из ответа модели</li>
          </Box>

          <Typography component="h2">База знаний (RAG)</Typography>
          <Box component="ul">
            <li>Поиск по документам памяти, проектов и агентов</li>
            <li>Настройки стратегии поиска и моделей эмбеддинга / reranker</li>
          </Box>
        </Box>

        <Box sx={{ borderTop: `1px solid ${border}`, mt: 3.5, pt: 2 }}>
          <Typography sx={{ color: muted, fontSize: '0.875rem' }}>
            AstraChat · релиз 1.0 · страница подробностей обновления
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Delete as DeleteIcon, HelpOutline as HelpOutlineIcon } from '@mui/icons-material';
import { getApiUrl, API_ENDPOINTS } from '../../config/api';

interface SkillFileRow {
  id: number;
  relative_path: string;
  category: string;
  bytes: number;
}

interface SkillFilesEditorProps {
  skillId: number;
  token: string;
  canWrite: boolean;
}

/** Заголовок раздела — как «Документы агента» в конструкторе. */
function SectionHeader({
  children,
  help,
  helpAriaLabel,
}: {
  children: React.ReactNode;
  help?: React.ReactNode;
  helpAriaLabel?: string;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography
        variant="caption"
        sx={{
          color: 'inherit',
          opacity: 0.65,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontSize: '0.7rem',
        }}
      >
        {children}
      </Typography>
      {help ? (
        <Tooltip title={help} arrow placement="top">
          <IconButton
            size="small"
            aria-label={helpAriaLabel || 'Справка'}
            sx={{
              p: 0.25,
              color: 'inherit',
              opacity: 0.45,
              '&:hover': { opacity: 0.75, bgcolor: 'transparent' },
            }}
          >
            <HelpOutlineIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      ) : null}
    </Box>
  );
}

export default function SkillFilesEditor({ skillId, token, canWrite }: SkillFilesEditorProps) {
  const [files, setFiles] = useState<SkillFileRow[]>([]);
  const [path, setPath] = useState('references/notes.md');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);

  const headers = useCallback((): HeadersInit => {
    const h: HeadersInit = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [token]);

  const load = useCallback(async () => {
    const resp = await fetch(`${getApiUrl(API_ENDPOINTS.SKILLS)}/${skillId}/files`, {
      headers: headers(),
    });
    if (!resp.ok) return;
    setFiles(await resp.json());
  }, [skillId, headers]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveFile = async () => {
    if (!path.trim() || !canWrite) return;
    setBusy(true);
    try {
      await fetch(`${getApiUrl(API_ENDPOINTS.SKILLS)}/${skillId}/files`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          relative_path: path.trim(),
          content,
          mime_type: 'text/plain',
        }),
      });
      setContent('');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const removeFile = async (id: number) => {
    if (!canWrite) return;
    await fetch(`${getApiUrl(API_ENDPOINTS.SKILLS)}/${skillId}/files/${id}`, {
      method: 'DELETE',
      headers: headers(),
    });
    await load();
  };

  return (
    <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}>
      <SectionHeader
        helpAriaLabel="Справка: вложенные файлы"
        help={
          <Box sx={{ maxWidth: 300 }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>
              Вложенные файлы
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.95 }}>
              Дополнительные материалы skill: скрипты, справки и ресурсы (scripts / references /
              assets). Основной текст инструкций задаётся в поле «Текст / SKILL.md» выше — сюда
              кладут сопутствующие файлы, на которые skill может ссылаться.
            </Typography>
          </Box>
        }
      >
        Вложенные файлы
      </SectionHeader>

      <List dense sx={{ mt: 0.5 }}>
        {files.map((f) => (
          <ListItem
            key={f.id}
            secondaryAction={
              canWrite ? (
                <IconButton
                  edge="end"
                  size="small"
                  onClick={() => void removeFile(f.id)}
                  aria-label="Удалить файл"
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              ) : null
            }
          >
            <ListItemText
              primary={f.relative_path}
              secondary={`${f.category} · ${f.bytes} Б`}
            />
          </ListItem>
        ))}
        {files.length === 0 && (
          <Typography variant="caption" color="text.secondary">
            Файлов пока нет.
          </Typography>
        )}
      </List>
      {canWrite && (
        <Stack gap={1} mt={1}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
            <TextField
              size="small"
              label="Относительный путь"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              fullWidth
            />
            <Tooltip
              arrow
              placement="top"
              title={
                <Box sx={{ maxWidth: 280 }}>
                  <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>
                    Относительный путь
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.95 }}>
                    Путь файла внутри skill. Обычно начинают с scripts/, references/ или assets/
                    — например scripts/run.sh или references/api.md.
                  </Typography>
                </Box>
              }
            >
              <IconButton
                size="small"
                aria-label="Справка: относительный путь"
                sx={{
                  mt: 0.75,
                  p: 0.35,
                  color: 'inherit',
                  opacity: 0.45,
                  '&:hover': { opacity: 0.75, bgcolor: 'transparent' },
                }}
              >
                <HelpOutlineIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
          <TextField
            size="small"
            label="Содержимое файла"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            multiline
            minRows={3}
          />
          <Button size="small" variant="outlined" disabled={busy} onClick={() => void saveFile()}>
            Сохранить файл
          </Button>
        </Stack>
      )}
    </Box>
  );
}

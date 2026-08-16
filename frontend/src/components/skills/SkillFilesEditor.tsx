import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Typography,
  List,
  ListItem,
  ListItemText,
} from '@mui/material';
import { Delete as DeleteIcon } from '@mui/icons-material';
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
      <Typography variant="subtitle2" gutterBottom>
        Вложенные файлы (scripts / references / assets)
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" mb={1}>
        Дополнительные материалы skill: скрипты, справки и ресурсы. Основной текст — в поле
        «Текст / SKILL.md» выше.
      </Typography>
      <List dense>
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
          <TextField
            size="small"
            label="Относительный путь"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            helperText="Например: scripts/run.sh или references/api.md"
          />
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

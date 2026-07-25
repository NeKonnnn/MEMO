import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Pagination,
  Select,
  Snackbar,
  Alert,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  FileDownload as ExportIcon,
  FileUpload as ImportIcon,
  Search as SearchIcon,
  Share as ShareIcon,
  HistoryEdu as SkillIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '@mui/material/styles';
import { getApiUrl, API_ENDPOINTS } from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import ShareSkillDialog from '../components/ShareSkillDialog';
import SkillFilesEditor from '../components/skills/SkillFilesEditor';

interface SkillItem {
  id: number;
  slug: string;
  name: string;
  display_title?: string | null;
  description?: string | null;
  content?: string;
  meta?: { tags?: string[] };
  is_active: boolean;
  is_public: boolean;
  user_invocable?: boolean;
  disable_model_invocation?: boolean;
  always_apply?: boolean;
  allowed_tools?: string[];
  category?: string | null;
  file_count?: number;
  author_id: string;
  author_name: string;
  created_at: string;
  updated_at: string;
  write_access?: boolean;
  is_shared_with_me?: boolean;
}

const emptyForm = {
  slug: '',
  name: '',
  display_title: '',
  description: '',
  content: '',
  is_active: true,
  is_public: false,
  user_invocable: true,
  disable_model_invocation: false,
  always_apply: false,
  allowed_tools: '' as string,
  category: '',
  tags: '' as string,
};

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseFrontmatter(md: string): { name?: string; description?: string; body: string } {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { body: md };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx > 0) {
      meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return { name: meta.name, description: meta.description, body: m[2] || '' };
}

export default function SkillsPage() {
  const { token, user } = useAuth();
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';
  const navigate = useNavigate();
  const importRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [query, setQuery] = useState('');
  const [viewOption, setViewOption] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SkillItem | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [shareTarget, setShareTarget] = useState<SkillItem | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  const authHeaders = useCallback((): HeadersInit => {
    const h: HeadersInit = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '12' });
      if (query.trim()) params.set('query', query.trim());
      if (viewOption) params.set('view_option', viewOption);
      const resp = await fetch(`${getApiUrl(API_ENDPOINTS.SKILLS)}/list?${params}`, {
        headers: authHeaders(),
      });
      if (!resp.ok) throw new Error('Не удалось загрузить skills');
      const data = await resp.json();
      setItems(data.items || []);
      setPages(data.pages || 1);
    } catch (e) {
      setSnackbar({
        open: true,
        message: e instanceof Error ? e.message : 'Ошибка загрузки',
        severity: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [token, page, query, viewOption, authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  const openEdit = async (skill: SkillItem) => {
    try {
      const resp = await fetch(`${getApiUrl(API_ENDPOINTS.SKILLS)}/${skill.id}`, {
        headers: authHeaders(),
      });
      if (!resp.ok) throw new Error('Не удалось загрузить skill');
      const full: SkillItem = await resp.json();
      setEditing(full);
      setForm({
        slug: full.slug,
        name: full.name,
        display_title: full.display_title || full.name,
        description: full.description || '',
        content: full.content || '',
        is_active: full.is_active,
        is_public: full.is_public,
        user_invocable: full.user_invocable !== false,
        disable_model_invocation: Boolean(full.disable_model_invocation),
        always_apply: Boolean(full.always_apply),
        allowed_tools: (full.allowed_tools || []).join(', '),
        category: full.category || '',
        tags: (full.meta?.tags || []).join(', '),
      });
      setFormOpen(true);
    } catch (e) {
      setSnackbar({
        open: true,
        message: e instanceof Error ? e.message : 'Ошибка',
        severity: 'error',
      });
    }
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.content.trim()) {
      setSnackbar({ open: true, message: 'Укажите имя и содержимое', severity: 'error' });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        slug: form.slug.trim() || slugify(form.name),
        name: form.name.trim(),
        display_title: form.display_title.trim() || form.name.trim(),
        description: form.description.trim() || null,
        content: form.content,
        is_active: form.is_active,
        is_public: form.is_public,
        user_invocable: form.user_invocable,
        disable_model_invocation: form.disable_model_invocation,
        always_apply: form.always_apply,
        allowed_tools: form.allowed_tools
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        category: form.category.trim() || null,
        meta: {
          tags: form.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
        },
      };
      const url = editing
        ? `${getApiUrl(API_ENDPOINTS.SKILLS)}/${editing.id}`
        : `${getApiUrl(API_ENDPOINTS.SKILLS)}/create`;
      const resp = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j.detail || 'Не удалось сохранить');
      }
      setFormOpen(false);
      setSnackbar({ open: true, message: editing ? 'Skill обновлён' : 'Skill создан', severity: 'success' });
      await load();
    } catch (e) {
      setSnackbar({
        open: true,
        message: e instanceof Error ? e.message : 'Ошибка',
        severity: 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (skill: SkillItem) => {
    try {
      const resp = await fetch(`${getApiUrl(API_ENDPOINTS.SKILLS)}/${skill.id}/toggle`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!resp.ok) throw new Error('Не удалось переключить');
      await load();
    } catch (e) {
      setSnackbar({
        open: true,
        message: e instanceof Error ? e.message : 'Ошибка',
        severity: 'error',
      });
    }
  };

  const handleClone = async (skill: SkillItem) => {
    try {
      const resp = await fetch(`${getApiUrl(API_ENDPOINTS.SKILLS)}/${skill.id}`, {
        headers: authHeaders(),
      });
      if (!resp.ok) throw new Error('Не удалось загрузить');
      const full: SkillItem = await resp.json();
      setEditing(null);
      setForm({
        slug: `${full.slug}-clone`,
        name: `${full.name} (Clone)`,
        display_title: `${full.display_title || full.name} (Clone)`,
        description: full.description || '',
        content: full.content || '',
        is_active: true,
        is_public: false,
        user_invocable: full.user_invocable !== false,
        disable_model_invocation: Boolean(full.disable_model_invocation),
        always_apply: false,
        allowed_tools: (full.allowed_tools || []).join(', '),
        category: full.category || '',
        tags: (full.meta?.tags || []).join(', '),
      });
      setFormOpen(true);
    } catch (e) {
      setSnackbar({
        open: true,
        message: e instanceof Error ? e.message : 'Ошибка',
        severity: 'error',
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const resp = await fetch(`${getApiUrl(API_ENDPOINTS.SKILLS)}/${deleteId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!resp.ok) throw new Error('Не удалось удалить');
      setDeleteId(null);
      setSnackbar({ open: true, message: 'Skill удалён', severity: 'success' });
      await load();
    } catch (e) {
      setSnackbar({
        open: true,
        message: e instanceof Error ? e.message : 'Ошибка',
        severity: 'error',
      });
    }
  };

  const handleExport = async () => {
    try {
      const resp = await fetch(`${getApiUrl(API_ENDPOINTS.SKILLS)}/export`, {
        headers: authHeaders(),
      });
      if (!resp.ok) throw new Error('Export failed');
      const data = await resp.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `skills-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setSnackbar({
        open: true,
        message: e instanceof Error ? e.message : 'Ошибка export',
        severity: 'error',
      });
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      if (file.name.endsWith('.json')) {
        const parsed = JSON.parse(text);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of list) {
          const payload = {
            slug: item.slug || slugify(item.name || 'skill'),
            name: item.name || item.slug || 'Imported skill',
            description: item.description || null,
            content: item.content || '',
            is_active: item.is_active !== false,
            is_public: Boolean(item.is_public),
            meta: item.meta || { tags: [] },
          };
          if (!payload.content) continue;
          await fetch(`${getApiUrl(API_ENDPOINTS.SKILLS)}/create`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(payload),
          });
        }
        setSnackbar({ open: true, message: 'Import завершён', severity: 'success' });
        await load();
      } else {
        const { name, description, body } = parseFrontmatter(text);
        setEditing(null);
        setForm({
          ...emptyForm,
          name: name || file.name.replace(/\.md$/i, ''),
          slug: slugify(name || file.name),
          description: description || '',
          content: body,
        });
        setFormOpen(true);
      }
    } catch (e) {
      setSnackbar({
        open: true,
        message: e instanceof Error ? e.message : 'Ошибка import',
        severity: 'error',
      });
    }
  };

  const canWrite = (s: SkillItem) =>
    Boolean(s.write_access) ||
    (user?.user_id || '').toLowerCase() === (s.author_id || '').toLowerCase() ||
    Boolean(user?.is_admin);

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={2} flexWrap="wrap" gap={1}>
        <Stack direction="row" alignItems="center" gap={1}>
          <SkillIcon color="primary" />
          <Typography variant="h5" fontWeight={600}>
            Skills
          </Typography>
          <Button size="small" onClick={() => navigate('/')}>
            К чату
          </Button>
        </Stack>
        <Stack direction="row" gap={1} flexWrap="wrap">
          <input
            ref={importRef}
            type="file"
            accept=".json,.md"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportFile(f);
              e.target.value = '';
            }}
          />
          <Button startIcon={<ImportIcon />} onClick={() => importRef.current?.click()}>
            Import
          </Button>
          <Button startIcon={<ExportIcon />} onClick={() => void handleExport()}>
            Export
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Создать
          </Button>
        </Stack>
      </Stack>

      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} mb={2}>
        <TextField
          size="small"
          placeholder="Поиск..."
          value={query}
          onChange={(e) => {
            setPage(1);
            setQuery(e.target.value);
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{ flex: 1 }}
        />
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Фильтр</InputLabel>
          <Select
            label="Фильтр"
            value={viewOption}
            onChange={(e) => {
              setPage(1);
              setViewOption(e.target.value);
            }}
          >
            <MenuItem value="">Все доступные</MenuItem>
            <MenuItem value="created">Мои</MenuItem>
            <MenuItem value="shared">Расшаренные мне</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      {loading ? (
        <Box display="flex" justifyContent="center" py={6}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 ? (
        <Typography color="text.secondary" py={4} textAlign="center">
          Skills пока нет. Создайте первый или импортируйте JSON/MD.
        </Typography>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            gap: 2,
          }}
        >
          {items.map((skill) => (
            <Card key={skill.id} variant="outlined">
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" gap={1}>
                  <Box>
                    <Typography variant="h6">{skill.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      ${skill.slug} · {skill.author_name}
                    </Typography>
                  </Box>
                  <Stack direction="row" alignItems="center" gap={0.5} flexWrap="wrap">
                    {!skill.is_active && <Chip size="small" label="off" color="default" />}
                    {skill.is_public && <Chip size="small" label="public" color="info" />}
                    {skill.is_shared_with_me && <Chip size="small" label="shared" />}
                    {skill.always_apply && <Chip size="small" label="always" color="secondary" />}
                    {skill.disable_model_invocation && <Chip size="small" label="no-model" />}
                    {skill.user_invocable === false && <Chip size="small" label="no-$" />}
                    {(skill.file_count || 0) > 0 && (
                      <Chip size="small" label={`${skill.file_count} files`} />
                    )}
                  </Stack>
                </Stack>
                {skill.description && (
                  <Typography variant="body2" color="text.secondary" mt={1} sx={{ whiteSpace: 'pre-wrap' }}>
                    {skill.description}
                  </Typography>
                )}
              </CardContent>
              <CardActions sx={{ justifyContent: 'space-between', px: 2, pb: 1.5 }}>
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={skill.is_active}
                      disabled={!canWrite(skill)}
                      onChange={() => void handleToggle(skill)}
                    />
                  }
                  label="Active"
                />
                <Stack direction="row">
                  <Tooltip title="Clone">
                    <IconButton size="small" onClick={() => void handleClone(skill)}>
                      <CopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {canWrite(skill) && (
                    <>
                      <Tooltip title="Share">
                        <IconButton size="small" onClick={() => setShareTarget(skill)}>
                          <ShareIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => void openEdit(skill)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={() => setDeleteId(skill.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </>
                  )}
                </Stack>
              </CardActions>
            </Card>
          ))}
        </Box>
      )}

      {pages > 1 && (
        <Box display="flex" justifyContent="center" mt={3}>
          <Pagination page={page} count={pages} onChange={(_, p) => setPage(p)} />
        </Box>
      )}

      <Dialog open={formOpen} onClose={() => setFormOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>{editing ? 'Редактировать skill' : 'Новый skill'}</DialogTitle>
        <DialogContent>
          <Stack gap={2} mt={1}>
            <TextField
              label="Название"
              value={form.name}
              onChange={(e) => {
                const name = e.target.value;
                setForm((f) => ({
                  ...f,
                  name,
                  display_title: editing ? f.display_title : name,
                  slug: editing ? f.slug : slugify(name),
                }));
              }}
              fullWidth
            />
            <TextField
              label="Display title (UI)"
              value={form.display_title}
              onChange={(e) => setForm((f) => ({ ...f, display_title: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Slug / machine name ($mention)"
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: slugify(e.target.value) }))}
              helperText="В чате: $slug"
              fullWidth
            />
            <TextField
              label="Description (when to use)"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              fullWidth
              multiline
              minRows={2}
            />
            <TextField
              label="Body / SKILL.md (markdown)"
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              fullWidth
              multiline
              minRows={10}
            />
            <TextField
              label="Category"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              fullWidth
            />
            <TextField
              label="allowed-tools (через запятую)"
              value={form.allowed_tools}
              onChange={(e) => setForm((f) => ({ ...f, allowed_tools: e.target.value }))}
              fullWidth
              helperText="MCP/tool ids — soft-union при manual/always-apply"
            />
            <TextField
              label="Теги (через запятую)"
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              fullWidth
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.is_public}
                  onChange={(e) => setForm((f) => ({ ...f, is_public: e.target.checked }))}
                />
              }
              label="Публичный (read для всех)"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.user_invocable}
                  onChange={(e) => setForm((f) => ({ ...f, user_invocable: e.target.checked }))}
                />
              }
              label="User-invocable ($ popover)"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.disable_model_invocation}
                  onChange={(e) => setForm((f) => ({ ...f, disable_model_invocation: e.target.checked }))}
                />
              }
              label="Disable model invocation"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.always_apply}
                  onChange={(e) => setForm((f) => ({ ...f, always_apply: e.target.checked }))}
                />
              }
              label="Always-apply"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                />
              }
              label="Active"
            />
            {editing && (
              <SkillFilesEditor skillId={editing.id} token={token || ''} canWrite={canWrite(editing)} />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormOpen(false)}>Отмена</Button>
          <Button variant="contained" disabled={saving} onClick={() => void handleSave()}>
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteId != null} onClose={() => setDeleteId(null)}>
        <DialogTitle>Удалить skill?</DialogTitle>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)}>Отмена</Button>
          <Button color="error" onClick={() => void handleDelete()}>
            Удалить
          </Button>
        </DialogActions>
      </Dialog>

      {shareTarget && (
        <ShareSkillDialog
          open={Boolean(shareTarget)}
          onClose={() => setShareTarget(null)}
          skillId={shareTarget.id}
          skillName={shareTarget.name}
          isDarkMode={isDarkMode}
        />
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar((s) => ({ ...s, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Container>
  );
}

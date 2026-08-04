import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CircularProgress,
  Container,
  InputAdornment,
  Pagination,
  Rating,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ContentCopy as CopyIcon,
  Person as PersonIcon,
  Search as SearchIcon,
  SmartToy as AgentIcon,
  TrendingUp as TrendingUpIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { getApiUrl } from '../config/api';
import { useAuth } from '../contexts/AuthContext';
import { useAppActions } from '../contexts/AppContext';
import { applyAgentModelAndSettings } from '../utils/applyAgentServer';
import { persistAgentMcpConfig } from '../utils/applyAgentMcp';
import { MODEL_SETTINGS_DEFAULT } from '../constants/modelSettingsStyles';
import {
  ASTRA_OPEN_AGENT_CONSTRUCTOR,
  ASTRA_OPEN_AGENT_CONSTRUCTOR_ID_KEY,
} from '../constants/hotkeys';

interface GalleryAgent {
  id: number;
  name: string;
  description?: string;
  system_prompt: string;
  config?: Record<string, unknown>;
  tools?: string[];
  author_id: string;
  author_name: string;
  is_public: boolean;
  usage_count: number;
  views_count: number;
  average_rating: number;
  total_votes: number;
  user_rating?: number | null;
  is_bookmarked?: boolean;
}

const STORAGE_AGENT_ID = 'active_agent_id';
const STORAGE_AGENT_NAME = 'active_agent_name';
const STORAGE_AGENT_PROMPT = 'active_agent_prompt';

/** Открыть агента в конструкторе (с ролями viewer/editor/owner). */
function openAgentInConstructor(agentId: number, navigate: (path: string) => void) {
  try {
    sessionStorage.setItem(ASTRA_OPEN_AGENT_CONSTRUCTOR_ID_KEY, String(agentId));
  } catch {
    /* */
  }
  navigate('/');
  window.setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent(ASTRA_OPEN_AGENT_CONSTRUCTOR, { detail: { agentId } }),
    );
  }, 80);
}

export default function AgentGalleryPage() {
  const { token } = useAuth();
  const { showNotification } = useAppActions();
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';
  const navigate = useNavigate();

  const [agents, setAgents] = useState<GalleryAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [usingId, setUsingId] = useState<number | null>(null);
  const loadingRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 400);
    return () => clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  const loadAgents = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        sort_by: 'rating',
        sort_order: 'desc',
      });
      if (debouncedSearch) params.set('search', debouncedSearch);

      const headers: HeadersInit = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      const resp = await fetch(`${getApiUrl('/api/agents/')}?${params}`, { headers });
      if (!resp.ok) {
        setAgents([]);
        setTotalPages(0);
        return;
      }
      const data = await resp.json();
      setAgents(data.agents || []);
      setTotalPages(data.pages || 1);
    } catch {
      setAgents([]);
      setTotalPages(0);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [page, debouncedSearch, token]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const handleRate = async (agentId: number, rating: number) => {
    if (!token) {
      showNotification('error', 'Для оценки нужно войти в систему');
      return;
    }
    try {
      const resp = await fetch(getApiUrl(`/api/agents/${agentId}/rate`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rating }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || 'Не удалось сохранить оценку');
      }
      showNotification('success', 'Оценка сохранена');
      await loadAgents();
    } catch (e: unknown) {
      showNotification('error', e instanceof Error ? e.message : 'Ошибка оценки');
    }
  };

  const handleUse = async (agent: GalleryAgent) => {
    if (!token) {
      showNotification('error', 'Для использования агента нужно войти в систему');
      return;
    }
    setUsingId(agent.id);
    try {
      const headers: HeadersInit = { Authorization: `Bearer ${token}` };

      if (!agent.is_bookmarked) {
        await fetch(getApiUrl(`/api/agents/${agent.id}/bookmark`), {
          method: 'POST',
          headers,
        });
      }

      await fetch(getApiUrl(`/api/agents/${agent.id}/use`), {
        method: 'POST',
        headers,
      });

      let full = agent;
      try {
        const detailResp = await fetch(getApiUrl(`/api/agents/${agent.id}`), { headers });
        if (detailResp.ok) {
          full = { ...agent, ...(await detailResp.json()) };
        }
      } catch {
        /* */
      }

      const cfg = (full.config || {}) as Record<string, unknown>;
      const modelPath = String(cfg.model || cfg.model_path || '')
        .trim()
        .replace(/^1lm-svc:\/\//i, 'llm-svc://')
        .replace(/\s+/g, '');
      const rawSettings = {
        ...MODEL_SETTINGS_DEFAULT,
        ...((cfg.model_settings as Record<string, unknown>) || {}),
      };

      const applied = await applyAgentModelAndSettings(token, {
        system_prompt: full.system_prompt || '',
        model_path: modelPath || null,
        model_settings: rawSettings,
      });

      localStorage.setItem(STORAGE_AGENT_ID, String(full.id));
      localStorage.setItem(STORAGE_AGENT_NAME, full.name);
      localStorage.setItem(STORAGE_AGENT_PROMPT, full.system_prompt || '');
      persistAgentMcpConfig(cfg);
      window.dispatchEvent(new CustomEvent('agentSelected', { detail: full }));

      if (!applied.ok) {
        showNotification(
          'warning',
          `Агент «${full.name}» добавлен в «Агенты из галереи», но настройки не применились: ${applied.message}`,
        );
      } else {
        showNotification('success', `Агент «${full.name}» добавлен и применён. Переходим в чат…`);
      }

      setTimeout(() => navigate('/'), 800);
    } catch (e: unknown) {
      showNotification('error', e instanceof Error ? e.message : 'Ошибка использования агента');
    } finally {
      setUsingId(null);
    }
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box sx={{ py: 2 }}>
        <Container maxWidth="xl">
          <Box sx={{ textAlign: 'center' }}>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1.5,
                mb: 0.5,
                flexWrap: 'wrap',
              }}
            >
              <AgentIcon color="primary" />
              <Typography variant="h4" fontWeight="bold">
                Галерея агентов
              </Typography>
              <Button size="small" onClick={() => navigate('/')}>
                К чату
              </Button>
              <Button size="small" onClick={() => navigate('/prompts')}>
                Галерея промптов
              </Button>
            </Box>
            <Typography variant="body2" color="text.secondary">
              Нажмите на карточку, чтобы открыть агента в конструкторе · «Использовать» — добавить в чат
            </Typography>
          </Box>
        </Container>
      </Box>

      <Box sx={{ py: 2 }}>
        <Container maxWidth="xl">
          <TextField
            fullWidth
            placeholder="Поиск агентов…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
          />
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ flex: 1, overflowY: 'auto', py: 3 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : agents.length === 0 ? (
          <Alert severity="info">
            Публичных агентов пока нет. Опубликуйте агента из конструктора кнопкой «Опубликовать в галерее».
          </Alert>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' },
              gap: 3,
            }}
          >
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                isDarkMode={isDarkMode}
                using={usingId === agent.id}
                onOpen={() => openAgentInConstructor(agent.id, navigate)}
                onRate={(rating) => void handleRate(agent.id, rating)}
                onUse={() => void handleUse(agent)}
              />
            ))}
          </Box>
        )}

        {totalPages > 1 && (
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
            <Pagination
              count={totalPages}
              page={page}
              onChange={(_, p) => setPage(p)}
              color="primary"
            />
          </Box>
        )}
      </Container>
    </Box>
  );
}

function AgentCard({
  agent,
  isDarkMode,
  using,
  onOpen,
  onRate,
  onUse,
}: {
  agent: GalleryAgent;
  isDarkMode: boolean;
  using: boolean;
  onOpen: () => void;
  onRate: (rating: number) => void;
  onUse: () => void;
}) {
  const preview =
    agent.description?.trim() ||
    (agent.system_prompt.length > 160
      ? `${agent.system_prompt.slice(0, 160)}…`
      : agent.system_prompt);

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: isDarkMode ? undefined : '#ffffff',
        boxShadow: isDarkMode ? undefined : '0 2px 8px rgba(0,0,0,0.1)',
        border: isDarkMode ? undefined : '1px solid rgba(0,0,0,0.08)',
        cursor: 'pointer',
        transition: 'box-shadow 0.15s ease',
        '&:hover': {
          boxShadow: isDarkMode ? '0 4px 16px rgba(0,0,0,0.45)' : '0 4px 16px rgba(0,0,0,0.14)',
        },
      }}
      onClick={onOpen}
    >
      <CardContent sx={{ flex: 1 }}>
        <Typography variant="h6" fontWeight="bold" sx={{ mb: 1 }}>
          {agent.name}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
          <PersonIcon fontSize="small" color="action" />
          <Typography variant="caption" color="text.secondary">
            {agent.author_name}
          </Typography>
        </Box>

        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            mb: 2,
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {preview}
        </Typography>

        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
          onClick={(e) => e.stopPropagation()}
        >
          <Rating
            value={agent.average_rating}
            precision={0.1}
            readOnly={!!agent.user_rating}
            onChange={(_, value) => {
              if (value !== null) onRate(Math.round(value));
            }}
          />
          <Typography variant="caption" color="text.secondary">
            {Number(agent.average_rating || 0).toFixed(1)} ({agent.total_votes || 0})
            {agent.user_rating ? ` • Ваша: ${agent.user_rating}` : ''}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
          <Tooltip title="Просмотров">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <ViewIcon fontSize="small" color="action" />
              <Typography variant="caption">{agent.views_count || 0}</Typography>
            </Box>
          </Tooltip>
          <Tooltip title="Использований">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <TrendingUpIcon fontSize="small" color="action" />
              <Typography variant="caption">{agent.usage_count || 0}</Typography>
            </Box>
          </Tooltip>
        </Box>
      </CardContent>

      <CardActions onClick={(e) => e.stopPropagation()}>
        <Button
          size="small"
          startIcon={using ? <CircularProgress size={14} /> : <CopyIcon />}
          onClick={onUse}
          disabled={using}
          fullWidth
          variant="contained"
        >
          Использовать
        </Button>
      </CardActions>
    </Card>
  );
}

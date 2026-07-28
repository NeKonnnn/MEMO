import React, { useState, useEffect, useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  IconButton,
  Tooltip,
  Popover,
} from '@mui/material';
import {
  LibraryBooks as LibraryBooksIcon,
  HelpOutline as HelpOutlineIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import MemoryRagLibraryModal from '../MemoryRagLibraryModal';
import { getApiUrl, getAuthFetchHeaders } from '../../config/api';
import {
  getDropdownPopoverPaperSx,
  getDropdownItemSx,
  getDropdownTriggerButtonSx,
  getDropdownTriggerTextSx,
  getDropdownChevronSx,
  getDropdownItemStateSx,
} from '../../constants/menuStyles';

type Variant = 'prominent' | 'inline';

interface Props {
  /** prominent — отдельная карточка сверху; inline — внутри другой карточки */
  variant?: Variant;
}

type MemoryStrategy = 'auto' | 'hybrid' | 'vector' | 'lexical' | 'graph';

const MEMORY_STRATEGY_OPTIONS: { value: MemoryStrategy; label: string }[] = [
  { value: 'auto', label: 'Автоматически' },
  { value: 'hybrid', label: 'Гибридный' },
  { value: 'vector', label: 'Векторный' },
  { value: 'lexical', label: 'Лексический' },
  { value: 'graph', label: 'Графовый' },
];

function normalizeMemoryStrategy(raw: unknown): MemoryStrategy {
  const s = String(raw || 'auto').trim().toLowerCase();
  return (MEMORY_STRATEGY_OPTIONS.some((o) => o.value === s) ? s : 'auto') as MemoryStrategy;
}

const LIBRARY_HELP =
  'Общие файлы для любого чата (не привязаны к проекту или агенту). Загрузите PDF, Word, Excel, TXT и включите переключатель — либо кнопку «Общий RAG» в чате.';

export default function MemoryRagLibrarySection({ variant = 'prominent' }: Props) {
  const theme = useTheme();
  const isDarkMode = theme.palette.mode === 'dark';
  const dropdownItemSx = useMemo(() => getDropdownItemSx(isDarkMode), [isDarkMode]);
  const dropdownTriggerSx = useMemo(() => getDropdownTriggerButtonSx(isDarkMode), [isDarkMode]);
  const dropdownTriggerTextSx = useMemo(() => getDropdownTriggerTextSx(isDarkMode), [isDarkMode]);
  const dropdownChevronSx = useMemo(() => getDropdownChevronSx(isDarkMode), [isDarkMode]);
  const [memoryRagModalOpen, setMemoryRagModalOpen] = useState(false);
  const [memoryStrategy, setMemoryStrategy] = useState<MemoryStrategy>('auto');
  const [strategySaving, setStrategySaving] = useState(false);
  const [strategyPopoverAnchor, setStrategyPopoverAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(getApiUrl('/api/rag/settings'), {
          headers: getAuthFetchHeaders(),
        });
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled) setMemoryStrategy(normalizeMemoryStrategy(data?.rag_memory_strategy));
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveMemoryStrategy = async (next: MemoryStrategy) => {
    setMemoryStrategy(next);
    setStrategySaving(true);
    try {
      await fetch(getApiUrl('/api/rag/settings'), {
        method: 'PUT',
        headers: getAuthFetchHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ rag_memory_strategy: next }),
      });
    } catch {
      // ignore
    } finally {
      setStrategySaving(false);
    }
  };

  const title = (
    <Typography
      variant={variant === 'prominent' ? 'h6' : 'subtitle2'}
      gutterBottom
      sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: variant === 'prominent' ? undefined : 500 }}
    >
      <LibraryBooksIcon color="primary" fontSize={variant === 'prominent' ? 'medium' : 'small'} />
      Общая библиотека документов
      <Tooltip title={LIBRARY_HELP} arrow>
        <IconButton
          size="small"
          sx={{
            ml: 0.5,
            opacity: 0.7,
            '&:hover': {
              opacity: 1,
              '& .MuiSvgIcon-root': {
                color: 'primary.main',
              },
            },
          }}
          aria-label="Справка: общая библиотека документов"
        >
          <HelpOutlineIcon fontSize="small" color="action" />
        </IconButton>
      </Tooltip>
    </Typography>
  );

  const inner = (
    <>
      {title}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
        <Button
          variant="contained"
          size="medium"
          startIcon={<LibraryBooksIcon />}
          onClick={() => setMemoryRagModalOpen(true)}
          sx={{
            px: 2.25,
            py: 1,
            borderRadius: 2.5,
            textTransform: 'none',
            fontWeight: 600,
            boxShadow: '0 10px 24px rgba(33,150,243,0.22)',
            background: 'linear-gradient(135deg, #1976d2 0%, #42a5f5 100%)',
            '&:hover': {
              boxShadow: '0 14px 28px rgba(33,150,243,0.28)',
              background: 'linear-gradient(135deg, #1565c0 0%, #1e88e5 100%)',
            },
          }}
        >
          Общая библиотека
        </Button>
      </Box>
      <Box
        sx={{
          mt: 2,
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'flex-start', sm: 'center' },
          gap: 1.5,
        }}
      >
        <Box>
          <Typography variant="body1" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontWeight: 500 }}>
            Стратегия поиска по библиотеке
            <Tooltip title="Способ поиска только по документам общей библиотеки." arrow>
              <IconButton size="small" sx={{ p: 0, opacity: 0.7 }}>
                <HelpOutlineIcon fontSize="small" color="action" />
              </IconButton>
            </Tooltip>
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            Отдельно от настроек проектов и агентов
          </Typography>
        </Box>
        <Button
          onClick={(event) => setStrategyPopoverAnchor(event.currentTarget)}
          endIcon={<ExpandMoreIcon sx={dropdownChevronSx} />}
          disabled={strategySaving}
          sx={{
            ...dropdownTriggerSx,
            minWidth: 220,
            justifyContent: 'space-between',
          }}
        >
          <Box component="span" sx={dropdownTriggerTextSx}>
            {MEMORY_STRATEGY_OPTIONS.find((option) => option.value === memoryStrategy)?.label ?? 'Автоматически'}
          </Box>
        </Button>
      </Box>
      <Popover
        open={Boolean(strategyPopoverAnchor)}
        anchorEl={strategyPopoverAnchor}
        onClose={() => setStrategyPopoverAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: getDropdownPopoverPaperSx(strategyPopoverAnchor, isDarkMode) } }}
      >
        <Box sx={{ p: 1, minWidth: 240 }}>
          {MEMORY_STRATEGY_OPTIONS.map((option) => {
            const selected = option.value === memoryStrategy;
            return (
              <Button
                key={option.value}
                fullWidth
                onClick={() => {
                  setStrategyPopoverAnchor(null);
                  void saveMemoryStrategy(option.value);
                }}
                sx={{
                  ...dropdownItemSx,
                  ...getDropdownItemStateSx(isDarkMode, selected),
                  justifyContent: 'flex-start',
                  textTransform: 'none',
                }}
              >
                {option.label}
              </Button>
            );
          })}
        </Box>
      </Popover>
      <MemoryRagLibraryModal open={memoryRagModalOpen} onClose={() => setMemoryRagModalOpen(false)} />
    </>
  );

  if (variant === 'inline') {
    return (
      <Box
        sx={{
          mb: 2,
          p: 2,
          borderRadius: 1,
          bgcolor: 'action.hover',
          border: 1,
          borderColor: 'divider',
        }}
      >
        {inner}
      </Box>
    );
  }

  return (
    <Card
      sx={{
        mb: 3,
        border: '1px solid',
        borderColor: 'divider',
        background: theme.palette.mode === 'dark'
          ? 'linear-gradient(180deg, rgba(33,150,243,0.08) 0%, rgba(33,150,243,0.03) 100%)'
          : 'linear-gradient(180deg, rgba(33,150,243,0.06) 0%, rgba(33,150,243,0.02) 100%)',
      }}
    >
      <CardContent>{inner}</CardContent>
    </Card>
  );
}

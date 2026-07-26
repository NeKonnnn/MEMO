import React, { useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  LibraryBooks as LibraryBooksIcon,
  HelpOutline as HelpOutlineIcon,
} from '@mui/icons-material';
import MemoryRagLibraryModal from '../MemoryRagLibraryModal';

type Variant = 'prominent' | 'inline';

interface Props {
  /** prominent — отдельная карточка сверху; inline — внутри другой карточки */
  variant?: Variant;
}

const LIBRARY_HELP =
  'Общие файлы для любого чата (не привязаны к проекту или агенту). Загрузите PDF, Word, Excel, TXT и включите переключатель — либо кнопку «Общий RAG» в чате.';

export default function MemoryRagLibrarySection({ variant = 'prominent' }: Props) {
  const [memoryRagModalOpen, setMemoryRagModalOpen] = useState(false);

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
          variant="outlined"
          color="primary"
          size="medium"
          startIcon={<LibraryBooksIcon />}
          onClick={() => setMemoryRagModalOpen(true)}
        >
          Открыть общую библиотеку
        </Button>
      </Box>
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
    <Card sx={{ mb: 3 }}>
      <CardContent>{inner}</CardContent>
    </Card>
  );
}

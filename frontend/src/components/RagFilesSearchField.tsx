import React from 'react';
import { IconButton, InputAdornment, TextField, type TextFieldProps } from '@mui/material';
import {
  Clear as ClearIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import type { SxProps, Theme } from '@mui/material/styles';

export interface RagFilesSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Сколько файлов всего (для placeholder / aria). */
  totalCount?: number;
  placeholder?: string;
  disabled?: boolean;
  size?: TextFieldProps['size'];
  sx?: SxProps<Theme>;
  /** Компактный вид для тёмной боковой панели агента */
  variant?: 'default' | 'sidebar';
}

/**
 * Поиск/отсечка по имени среди прикреплённых RAG-файлов
 * (агент / проект / общая библиотека memory).
 */
export default function RagFilesSearchField({
  value,
  onChange,
  totalCount,
  placeholder,
  disabled = false,
  size = 'small',
  sx,
  variant = 'default',
}: RagFilesSearchFieldProps) {
  const isSidebar = variant === 'sidebar';
  const resolvedPlaceholder =
    placeholder ||
    (typeof totalCount === 'number' && totalCount > 0
      ? `Поиск среди ${totalCount} файлов…`
      : 'Поиск по имени файла…');

  return (
    <TextField
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={resolvedPlaceholder}
      disabled={disabled}
      size={size}
      fullWidth
      inputProps={{ 'aria-label': 'Поиск по прикреплённым файлам' }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon
              sx={{
                fontSize: isSidebar ? 16 : 20,
                color: isSidebar ? 'rgba(255,255,255,0.45)' : 'text.secondary',
              }}
            />
          </InputAdornment>
        ),
        endAdornment: value ? (
          <InputAdornment position="end">
            <IconButton
              size="small"
              aria-label="Очистить поиск"
              onClick={() => onChange('')}
              edge="end"
              sx={{
                color: isSidebar ? 'rgba(255,255,255,0.55)' : undefined,
                p: isSidebar ? 0.25 : undefined,
              }}
            >
              <ClearIcon sx={{ fontSize: isSidebar ? 14 : 18 }} />
            </IconButton>
          </InputAdornment>
        ) : undefined,
      }}
      sx={[
        isSidebar
          ? {
              mb: 0.75,
              '& .MuiOutlinedInput-root': {
                bgcolor: 'rgba(255,255,255,0.06)',
                color: 'rgba(255,255,255,0.9)',
                fontSize: '0.75rem',
                '& fieldset': { borderColor: 'rgba(255,255,255,0.12)' },
                '&:hover fieldset': { borderColor: 'rgba(255,255,255,0.25)' },
                '&.Mui-focused fieldset': { borderColor: 'rgba(33,150,243,0.7)' },
              },
              '& .MuiInputBase-input::placeholder': {
                color: 'rgba(255,255,255,0.4)',
                opacity: 1,
              },
            }
          : { mb: 1.5 },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ] as SxProps<Theme>}
    />
  );
}

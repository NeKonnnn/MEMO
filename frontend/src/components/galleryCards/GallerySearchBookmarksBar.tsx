import React from 'react';
import { Box, Button, InputAdornment, TextField } from '@mui/material';
import { Bookmark as BookmarkIcon, Search as SearchIcon } from '@mui/icons-material';

/** Высота строки поиска и кнопки «Закладки» в галерее. */
export const GALLERY_TOOLBAR_CONTROL_HEIGHT_PX = 40;

export interface GallerySearchBookmarksBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  showBookmarks: boolean;
  onToggleBookmarks: () => void;
  bookmarksEnabled?: boolean;
  searchDisabled?: boolean;
  allLabel?: string;
  bookmarksLabel?: string;
}

/** Кнопка «Закладки» слева + поиск (одинаковая высота). */
export default function GallerySearchBookmarksBar({
  searchQuery,
  onSearchChange,
  searchPlaceholder = 'Поиск…',
  showBookmarks,
  onToggleBookmarks,
  bookmarksEnabled = true,
  searchDisabled = false,
  allLabel = 'Все',
  bookmarksLabel = 'Закладки',
}: GallerySearchBookmarksBarProps) {
  const h = GALLERY_TOOLBAR_CONTROL_HEIGHT_PX;
  const greyBorder = 'rgba(255,255,255,0.28)';
  const greyBorderLight = 'rgba(0,0,0,0.28)';

  return (
    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
      {bookmarksEnabled && (
        <Button
          variant="outlined"
          startIcon={<BookmarkIcon />}
          onClick={onToggleBookmarks}
          sx={(theme) => {
            const isDark = theme.palette.mode === 'dark';
            const border = isDark ? greyBorder : greyBorderLight;
            const activeBg = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
            return {
              textTransform: 'none',
              flexShrink: 0,
              height: h,
              minHeight: h,
              px: 1.5,
              color: 'text.secondary',
              borderColor: border,
              bgcolor: showBookmarks ? activeBg : 'transparent',
              '&:hover': {
                borderColor: isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)',
                bgcolor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)',
              },
            };
          }}
        >
          {showBookmarks ? allLabel : bookmarksLabel}
        </Button>
      )}
      <Box sx={{ flex: '1 1 240px', minWidth: '200px' }}>
        <TextField
          fullWidth
          size="small"
          placeholder={searchPlaceholder}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          disabled={searchDisabled || showBookmarks}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            sx: {
              height: h,
              '& .MuiOutlinedInput-input': {
                py: 0,
                height: h,
                boxSizing: 'border-box',
              },
            },
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              height: h,
            },
          }}
        />
      </Box>
    </Box>
  );
}

import React from 'react';
import {
  Box,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
} from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  SIDEBAR_CHAT_ROW_LIST_ITEM_BUTTON_SX,
  SIDEBAR_LIST_ICON_SX,
  SIDEBAR_LIST_ICON_TO_TEXT_GAP_PX,
  getSidebarRailCollapsedListItemButtonSx,
} from '../../constants/menuStyles';
import { SidebarRailPromptsIcon } from '../../constants/sidebarRailIcons';

type GalleryNavVariant = 'collapsed' | 'expanded';

interface GalleryNavButtonProps {
  variant: GalleryNavVariant;
  isDarkMode: boolean;
  /** Светлый фон боковой панели — тёмные иконки/текст. */
  panelIsLight?: boolean;
}

/**
 * Кнопка «Галерея» на правой панели: переход на единую страницу `/gallery`
 * (агенты, skills, плагины).
 */
export default function GalleryNavButton({
  variant,
  panelIsLight = false,
}: GalleryNavButtonProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const active = location.pathname === '/gallery';

  const rowHoverBg = panelIsLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)';
  const rowActiveBg = panelIsLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)';

  const handleGo = () => navigate('/gallery');

  if (variant === 'collapsed') {
    return (
      <ListItem disablePadding sx={{ mb: 0.5, display: 'block' }}>
        <Tooltip title="Галерея" placement="left">
          <Box component="span" sx={{ display: 'flex', width: '100%', justifyContent: 'center' }}>
            <ListItemButton
              onClick={handleGo}
              selected={active}
              sx={getSidebarRailCollapsedListItemButtonSx(panelIsLight)}
            >
              <SidebarRailPromptsIcon sx={SIDEBAR_LIST_ICON_SX} />
            </ListItemButton>
          </Box>
        </Tooltip>
      </ListItem>
    );
  }

  return (
    <ListItem disablePadding sx={{ mb: 0.5 }}>
      <ListItemButton
        onClick={handleGo}
        selected={active}
        sx={{
          ...SIDEBAR_CHAT_ROW_LIST_ITEM_BUTTON_SX,
          color: 'inherit',
          backgroundColor: active ? rowActiveBg : 'transparent',
          '&:hover': {
            backgroundColor: rowHoverBg,
          },
        }}
      >
        <ListItemIcon
          sx={{
            color: 'inherit',
            minWidth: 40,
            mr: `${SIDEBAR_LIST_ICON_TO_TEXT_GAP_PX}px`,
            '& .MuiSvgIcon-root': { fontSize: '1.375rem' },
          }}
        >
          <SidebarRailPromptsIcon />
        </ListItemIcon>
        <ListItemText
          primary="Галерея"
          primaryTypographyProps={{
            sx: { fontSize: '0.8rem', fontWeight: 400, color: 'inherit' },
          }}
        />
      </ListItemButton>
    </ListItem>
  );
}

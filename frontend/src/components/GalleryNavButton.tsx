import React, { useMemo, useState } from 'react';
import {
  Box,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Popover,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AutoAwesome as PromptsIcon,
  SmartToy as AgentsIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import {
  SIDEBAR_CHAT_ROW_LIST_ITEM_BUTTON_SX,
  SIDEBAR_LIST_ICON_SX,
  SIDEBAR_LIST_ICON_TO_TEXT_GAP_PX,
  getSidebarRailCollapsedListItemButtonSx,
  getDropdownPanelSx,
  getDropdownItemSx,
  getMenuColors,
  MENU_ACTION_TEXT_SIZE,
  MENU_COMPACT_PANEL_WIDTH_PX,
} from '../constants/menuStyles';
import { SidebarRailPromptsIcon } from '../constants/sidebarRailIcons';

type GalleryNavVariant = 'collapsed' | 'expanded';

interface GalleryNavButtonProps {
  variant: GalleryNavVariant;
  isDarkMode: boolean;
}

const GALLERY_ITEMS = [
  {
    path: '/prompts',
    label: 'Галерея промптов',
    Icon: PromptsIcon,
  },
  {
    path: '/agents-gallery',
    label: 'Галерея агентов',
    Icon: AgentsIcon,
  },
] as const;

/**
 * Одна кнопка «Галерея» на правой панели: по клику — выбор
 * «Галерея промптов» или «Галерея агентов».
 * Выпадающий список — тот же дизайн, что меню «Перейти в проект».
 */
export default function GalleryNavButton({ variant, isDarkMode }: GalleryNavButtonProps) {
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const { menuItemColor } = useMemo(() => getMenuColors(isDarkMode), [isDarkMode]);
  const dropdownPanelSx = useMemo(() => getDropdownPanelSx(isDarkMode), [isDarkMode]);
  const dropdownItemSx = useMemo(() => getDropdownItemSx(isDarkMode), [isDarkMode]);
  const submenuIconColor = isDarkMode ? '#ffffff' : 'rgba(0,0,0,0.6)';

  const handleOpen = (e: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(e.currentTarget);
  };

  const handleClose = () => setAnchorEl(null);

  const handleGo = (path: string) => {
    handleClose();
    navigate(path);
  };

  const menu = (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={handleClose}
      // Справа → влево, верх пункта «Галерея» = верх меню (как подменю «Перейти в проект»)
      anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      marginThreshold={8}
      slotProps={{
        paper: {
          sx: {
            // Зазор между панелью и кнопкой (как left: calc(100% + 6px) у подменю проектов)
            mr: '6px',
            p: 0,
            overflow: 'visible',
            background: 'transparent !important',
            backgroundColor: 'transparent !important',
            boxShadow: 'none !important',
            border: 'none',
          },
        },
      }}
    >
      <Box
        sx={{
          ...dropdownPanelSx,
          width: MENU_COMPACT_PANEL_WIDTH_PX,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box sx={{ py: 0.5, px: 0.5 }}>
          {GALLERY_ITEMS.map((item) => (
            <Box
              key={item.path}
              onClick={() => handleGo(item.path)}
              sx={{
                ...dropdownItemSx,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                color: menuItemColor,
              }}
            >
              <item.Icon sx={{ fontSize: 22, color: submenuIconColor, flexShrink: 0 }} />
              <Typography sx={{ flex: 1, fontSize: MENU_ACTION_TEXT_SIZE }}>{item.label}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </Popover>
  );

  if (variant === 'collapsed') {
    return (
      <>
        <ListItem disablePadding sx={{ mb: 0.5, display: 'block' }}>
          <Tooltip title="Галерея" placement="left">
            <Box component="span" sx={{ display: 'flex', width: '100%', justifyContent: 'center' }}>
              <ListItemButton
                onClick={handleOpen}
                selected={open}
                sx={getSidebarRailCollapsedListItemButtonSx(isDarkMode)}
              >
                <SidebarRailPromptsIcon sx={SIDEBAR_LIST_ICON_SX} />
              </ListItemButton>
            </Box>
          </Tooltip>
        </ListItem>
        {menu}
      </>
    );
  }

  return (
    <>
      <ListItem disablePadding sx={{ mb: 0.5 }}>
        <ListItemButton
          onClick={handleOpen}
          selected={open}
          sx={{
            ...SIDEBAR_CHAT_ROW_LIST_ITEM_BUTTON_SX,
            color: 'var(--sidebar-fg, #ffffff)',
            backgroundColor: open ? 'var(--sidebar-selected-bg, rgba(255,255,255,0.12))' : 'transparent',
            '&:hover': {
              backgroundColor: 'var(--sidebar-hover-bg, rgba(255,255,255,0.08))',
            },
          }}
        >
          <ListItemIcon
            sx={{
              color: 'var(--sidebar-fg, #ffffff)',
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
              sx: { fontSize: '0.8rem', fontWeight: 400, color: 'var(--sidebar-fg, #ffffff)' },
            }}
          />
          <ExpandMoreIcon
            sx={{
              fontSize: 18,
              color: 'var(--sidebar-muted-fg, rgba(255,255,255,0.55))',
              transform: open ? 'rotate(180deg)' : 'rotate(-90deg)',
              transition: 'transform 0.15s ease',
            }}
          />
        </ListItemButton>
      </ListItem>
      {menu}
    </>
  );
}

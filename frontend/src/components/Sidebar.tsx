import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  IconButton,
  Box,
  Typography,
  Tooltip,
  Switch,
  FormControlLabel,
  Avatar,
  Chip,
} from '@mui/material';
import {
  Chat as ChatIcon,
  Mic as MicIcon,
  Description as DocumentIcon,
  Transcribe as TranscribeIcon,
  Settings as SettingsIcon,
  History as HistoryIcon,
  Menu as MenuIcon,
  Brightness4 as DarkModeIcon,
  Brightness7 as LightModeIcon,
  Computer as ComputerIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { useAppContext } from '../contexts/AppContext';
import { useSocket } from '../contexts/SocketContext';

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
}

const menuItems = [
  { path: '/chat', label: 'Чат', icon: ChatIcon, description: 'Чат, голос, документы' },
  { path: '/transcription', label: 'Транскрибация', icon: TranscribeIcon },
  { path: '/history', label: 'История', icon: HistoryIcon },
  { path: '/settings', label: 'Настройки', icon: SettingsIcon },
];

export default function Sidebar({ open, onToggle, isDarkMode, onToggleTheme }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { state } = useAppContext();
  const { isConnected } = useSocket();

  const handleNavigation = (path: string) => {
    navigate(path);
  };

  return (
    <Drawer
      variant="persistent"
      anchor="left"
      open={open}
      sx={{
        width: 280,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: 280,
          boxSizing: 'border-box',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          borderRight: 'none',
        },
      }}
    >
      {/* Заголовок */}
      <Box
        sx={{
          p: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(0,0,0,0.1)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar sx={{ bgcolor: 'rgba(255,255,255,0.2)' }}>
            <ComputerIcon />
          </Avatar>
          <Box>
            <Typography variant="h6" fontWeight="bold">
              Газик ИИ
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.8 }}>
              Web Interface
            </Typography>
          </Box>
        </Box>

      </Box>

      {/* Статус соединения */}
      <Box sx={{ px: 2, pb: 1 }}>
        <Chip
          size="small"
          icon={<InfoIcon fontSize="small" />}
          label={isConnected ? 'Подключено' : 'Отключено'}
          color={isConnected ? 'success' : 'error'}
          variant="outlined"
          sx={{ 
            color: 'white',
            borderColor: isConnected ? 'rgba(76, 175, 80, 0.5)' : 'rgba(244, 67, 54, 0.5)',
          }}
        />
      </Box>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.2)' }} />

      {/* Навигационное меню */}
      <List sx={{ flexGrow: 1, px: 1 }}>
        {menuItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          
          return (
            <ListItem key={item.path} disablePadding sx={{ mb: 0.5 }}>
              <ListItemButton
                onClick={() => handleNavigation(item.path)}
                sx={{
                  borderRadius: 2,
                  backgroundColor: isActive ? 'rgba(255,255,255,0.2)' : 'transparent',
                  '&:hover': {
                    backgroundColor: 'rgba(255,255,255,0.1)',
                  },
                  transition: 'all 0.2s ease',
                }}
              >
                <ListItemIcon sx={{ color: 'white', minWidth: 40 }}>
                  <Icon />
                </ListItemIcon>
                <ListItemText 
                  primary={item.label}
                  secondary={item.description}
                  primaryTypographyProps={{
                    fontWeight: isActive ? 600 : 400,
                  }}
                  secondaryTypographyProps={{
                    sx: { opacity: 0.8, fontSize: '0.75rem' }
                  }}
                />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>

      <Divider sx={{ borderColor: 'rgba(255,255,255,0.2)' }} />

      {/* Информация о модели */}
      <Box sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, opacity: 0.8 }}>
          Текущая модель
        </Typography>
        {state.currentModel?.loaded ? (
          <Box>
            <Typography variant="body2" fontWeight="500">
              {state.currentModel.metadata?.['general.name'] || 'Загружена'}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              {state.currentModel.metadata?.['general.architecture'] || 'Неизвестная архитектура'}
            </Typography>
          </Box>
        ) : (
          <Typography variant="body2" sx={{ opacity: 0.7 }}>
            Модель не загружена
          </Typography>
        )}
      </Box>

      {/* Статистика */}
      <Box sx={{ p: 2, background: 'rgba(0,0,0,0.1)' }}>
        <Typography variant="subtitle2" sx={{ mb: 1, opacity: 0.8 }}>
          Статистика сессии
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h6" fontWeight="bold">
              {state.messages.length}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              Сообщений
            </Typography>
          </Box>
          <Box>
            <Typography variant="h6" fontWeight="bold">
              {state.stats.totalTokens}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              Токенов
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Переключатель темы */}
      <Box sx={{ p: 2, background: 'rgba(0,0,0,0.2)' }}>
        <FormControlLabel
          control={
            <Switch
              checked={isDarkMode}
              onChange={onToggleTheme}
              size="small"
              sx={{
                '& .MuiSwitch-switchBase.Mui-checked': {
                  color: 'white',
                },
                '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
                  backgroundColor: 'rgba(255,255,255,0.3)',
                },
              }}
            />
          }
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {isDarkMode ? <DarkModeIcon fontSize="small" /> : <LightModeIcon fontSize="small" />}
              <Typography variant="body2">
                {isDarkMode ? 'Темная тема' : 'Светлая тема'}
              </Typography>
            </Box>
          }
          sx={{ color: 'white', margin: 0 }}
        />
      </Box>
    </Drawer>
  );
}

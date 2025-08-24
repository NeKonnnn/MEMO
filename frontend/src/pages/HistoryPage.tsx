import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Container,
  Card,
  CardContent,
  Button,
  IconButton,
  Chip,
  TextField,
  InputAdornment,
  List,
  ListItem,
  Avatar,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Fab,
  Tooltip,
} from '@mui/material';
import {
  Search as SearchIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  Clear as ClearIcon,
  Person as PersonIcon,
  SmartToy as BotIcon,
  DateRange as DateIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useAppContext, useAppActions } from '../contexts/AppContext';

interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export default function HistoryPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [filteredHistory, setFilteredHistory] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<HistoryEntry | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  
  const { state } = useAppContext();
  const { showNotification, clearMessages } = useAppActions();

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    // Фильтрация истории по поисковому запросу
    if (!searchQuery.trim()) {
      setFilteredHistory(history);
    } else {
      const filtered = history.filter(entry =>
        entry.content.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredHistory(filtered);
    }
  }, [searchQuery, history]);

  const loadHistory = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('http://localhost:8000/api/history?limit=1000');
      const result = await response.json();
      
      if (result.history) {
        setHistory(result.history);
        showNotification('success', `Загружено ${result.count} записей истории`);
      } else {
        setHistory([]);
      }
    } catch (error) {
      console.error('Ошибка загрузки истории:', error);
      showNotification('error', 'Не удалось загрузить историю');
      // Используем локальную историю из состояния
      setHistory(state.messages);
    } finally {
      setIsLoading(false);
    }
  };

  const clearHistory = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/history', {
        method: 'DELETE',
      });
      
      const result = await response.json();
      
      if (result.success) {
        setHistory([]);
        clearMessages(); // Очищаем также локальное состояние
        showNotification('success', 'История очищена');
        setShowClearDialog(false);
      } else {
        showNotification('error', 'Не удалось очистить историю');
      }
    } catch (error) {
      console.error('Ошибка очистки истории:', error);
      showNotification('error', 'Ошибка при очистке истории');
    }
  };

  const exportHistory = () => {
    const text = filteredHistory
      .map(entry => {
        const timestamp = new Date(entry.timestamp).toLocaleString('ru-RU');
        const role = entry.role === 'user' ? 'Пользователь' : 'MemoAI';
        return `[${timestamp}] ${role}: ${entry.content}`;
      })
      .join('\n\n');
    
    const blob = new Blob([text], { type: 'text/plain; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `memoai_history_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    
    showNotification('success', 'История экспортирована');
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      return date.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } else {
      return date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  };

  const truncateText = (text: string, maxLength: number = 100) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  const getStatistics = () => {
    const totalMessages = history.length;
    const userMessages = history.filter(h => h.role === 'user').length;
    const assistantMessages = history.filter(h => h.role === 'assistant').length;
    const totalChars = history.reduce((sum, h) => sum + h.content.length, 0);
    
    return {
      totalMessages,
      userMessages,
      assistantMessages,
      totalChars,
    };
  };

  const stats = getStatistics();

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Заголовок */}
      <Paper elevation={2} sx={{ p: 2, borderRadius: 0 }}>
        <Container maxWidth="lg">
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box>
              <Typography variant="h5" fontWeight="600">
                📚 История диалогов
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Просмотр и управление историей общения с AI ассистентом
              </Typography>
            </Box>
            
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Tooltip title={isLoading ? 'Загрузка...' : 'Обновить историю'}>
                <span>
                  <IconButton onClick={loadHistory} disabled={isLoading}>
                    <RefreshIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Button
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={exportHistory}
                disabled={filteredHistory.length === 0}
              >
                Экспорт
              </Button>
              {history.length > 0 && (
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={() => setShowClearDialog(true)}
                >
                  Очистить
                </Button>
              )}
            </Box>
          </Box>
        </Container>
      </Paper>

      <Container maxWidth="lg" sx={{ flexGrow: 1, py: 3 }}>
        <Box sx={{ display: 'flex', gap: 3, height: '100%' }}>
          {/* Левая панель - статистика */}
          <Card sx={{ width: 300, display: 'flex', flexDirection: 'column' }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Статистика
              </Typography>
              
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2">Всего сообщений:</Typography>
                  <Chip label={stats.totalMessages} size="small" color="primary" />
                </Box>
                
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2">От пользователя:</Typography>
                  <Chip label={stats.userMessages} size="small" color="secondary" />
                </Box>
                
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2">От ассистента:</Typography>
                  <Chip label={stats.assistantMessages} size="small" color="success" />
                </Box>
                
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2">Всего символов:</Typography>
                  <Chip label={stats.totalChars.toLocaleString()} size="small" />
                </Box>
              </Box>
              
              <Divider sx={{ my: 2 }} />
              
              <Typography variant="subtitle2" gutterBottom>
                Поиск в истории
              </Typography>
              <TextField
                fullWidth
                size="small"
                placeholder="Поиск сообщений..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  ),
                  endAdornment: searchQuery && (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() => setSearchQuery('')}
                      >
                        <ClearIcon />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              
              {searchQuery && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  Найдено: {filteredHistory.length} из {history.length}
                </Typography>
              )}
            </CardContent>
          </Card>

          {/* Правая панель - список сообщений */}
          <Card sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
            <CardContent sx={{ flexGrow: 1, p: 0 }}>
              {filteredHistory.length === 0 ? (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  {isLoading ? (
                    <Typography>Загрузка истории...</Typography>
                  ) : history.length === 0 ? (
                    <Box>
                      <BotIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                      <Typography variant="h6" color="text.secondary">
                        История пуста
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Начните диалог, чтобы сообщения появились здесь
                      </Typography>
                    </Box>
                  ) : (
                    <Box>
                      <SearchIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                      <Typography variant="h6" color="text.secondary">
                        Ничего не найдено
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Попробуйте изменить поисковый запрос
                      </Typography>
                    </Box>
                  )}
                </Box>
              ) : (
                <List sx={{ p: 0, maxHeight: '100%', overflow: 'auto' }}>
                  {filteredHistory.map((entry, index) => {
                    const isUser = entry.role === 'user';
                    return (
                      <React.Fragment key={index}>
                        <ListItem
                          sx={{
                            alignItems: 'flex-start',
                            cursor: 'pointer',
                            '&:hover': {
                              backgroundColor: 'action.hover',
                            },
                          }}
                          onClick={() => {
                            setSelectedEntry(entry);
                            setShowDetailDialog(true);
                          }}
                        >
                          <Avatar
                            sx={{
                              mr: 2,
                              mt: 0.5,
                              width: 32,
                              height: 32,
                              backgroundColor: isUser ? 'primary.main' : 'secondary.main',
                            }}
                          >
                            {isUser ? <PersonIcon fontSize="small" /> : <BotIcon fontSize="small" />}
                          </Avatar>
                          
                          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                              <Typography variant="subtitle2" fontWeight="500">
                                {isUser ? 'Вы' : 'MemoAI'}
                              </Typography>
                              <Chip
                                size="small"
                                icon={<DateIcon />}
                                label={formatTimestamp(entry.timestamp)}
                                variant="outlined"
                                sx={{ fontSize: '0.7rem', height: 20 }}
                              />
                            </Box>
                            
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{
                                whiteSpace: 'pre-line',
                                wordBreak: 'break-word',
                              }}
                            >
                              {truncateText(entry.content)}
                            </Typography>
                          </Box>
                        </ListItem>
                        
                        {index < filteredHistory.length - 1 && <Divider variant="inset" component="li" />}
                      </React.Fragment>
                    );
                  })}
                </List>
              )}
            </CardContent>
          </Card>
        </Box>
      </Container>

      {/* Плавающая кнопка очистки */}
      {history.length > 0 && (
        <Fab
          color="error"
          sx={{ position: 'fixed', bottom: 24, right: 24 }}
          onClick={() => setShowClearDialog(true)}
        >
          <DeleteIcon />
        </Fab>
      )}

      {/* Диалог подтверждения очистки */}
      <Dialog
        open={showClearDialog}
        onClose={() => setShowClearDialog(false)}
      >
        <DialogTitle>Очистить историю?</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            Это действие необратимо. Все сообщения будут удалены навсегда.
          </Alert>
          <Typography>
            Будет удалено {history.length} сообщений из истории диалогов.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowClearDialog(false)}>
            Отмена
          </Button>
          <Button onClick={clearHistory} color="error" variant="contained">
            Очистить историю
          </Button>
        </DialogActions>
      </Dialog>

      {/* Диалог просмотра сообщения */}
      <Dialog
        open={showDetailDialog}
        onClose={() => setShowDetailDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Avatar
              sx={{
                width: 32,
                height: 32,
                backgroundColor: selectedEntry?.role === 'user' ? 'primary.main' : 'secondary.main',
              }}
            >
              {selectedEntry?.role === 'user' ? <PersonIcon fontSize="small" /> : <BotIcon fontSize="small" />}
            </Avatar>
            <Box>
              <Typography variant="h6">
                {selectedEntry?.role === 'user' ? 'Сообщение пользователя' : 'Ответ MemoAI'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {selectedEntry && formatTimestamp(selectedEntry.timestamp)}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Paper variant="outlined" sx={{ p: 2, backgroundColor: 'background.default' }}>
            <Typography
              variant="body1"
              sx={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: 1.6,
              }}
            >
              {selectedEntry?.content}
            </Typography>
          </Paper>
        </DialogContent>
        <DialogActions>
          <Button
            startIcon={<DownloadIcon />}
            onClick={() => {
              if (selectedEntry) {
                const blob = new Blob([selectedEntry.content], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `message_${new Date(selectedEntry.timestamp).toISOString()}.txt`;
                a.click();
                URL.revokeObjectURL(url);
              }
            }}
          >
            Скачать
          </Button>
          <Button onClick={() => setShowDetailDialog(false)} variant="contained">
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

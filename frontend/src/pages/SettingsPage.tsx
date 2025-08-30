import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Container,
  Card,
  CardContent,
  TextField,
  Button,
  Switch,
  FormControl,
  FormControlLabel,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  List,
  ListItem,
  ListItemText,
  LinearProgress,
  IconButton,
  Collapse,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  CircularProgress,
} from '@mui/material';
import {
  Save as SaveIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Upload as UploadIcon,
  Computer as ComputerIcon,
  VolumeUp as VolumeUpIcon,
} from '@mui/icons-material';
import { useAppActions } from '../contexts/AppContext';

// Backend URL
const API_BASE_URL = 'http://localhost:8000';

export default function SettingsPage() {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isVisible, setIsVisible] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const [modelSettings, setModelSettings] = useState({
    context_size: 2048,
    output_tokens: 512,
    temperature: 0.7,
    top_p: 0.95,
    repeat_penalty: 1.05,
    use_gpu: false,
    streaming: true,
    streaming_speed: 50, // Скорость потоковой генерации в миллисекундах
  });

  const [voiceSettings, setVoiceSettings] = useState({
    voice_id: "ru",
    speech_rate: 1.0,
    voice_speaker: "baya", // Добавляем выбор конкретного голоса
  });

  const [transcriptionSettings, setTranscriptionSettings] = useState({
    engine: "whisperx" as "whisperx" | "vosk",
    language: "ru",
    auto_detect: true,
  });

  const [availableModels, setAvailableModels] = useState<Array<{
    name: string;
    path: string;
    size: number;
    size_mb: number;
  }>>([]);

  const [selectedModelPath, setSelectedModelPath] = useState<string>("");
  const [currentModel, setCurrentModel] = useState<any>(null);
  const [isLoadingModel, setIsLoadingModel] = useState(false);
  const [showModelDialog, setShowModelDialog] = useState(false);
  
  // Состояние для тестирования голоса
  const [isTestingVoice, setIsTestingVoice] = useState(false);
  const [showVoiceTestDialog, setShowVoiceTestDialog] = useState(false);
  const [selectedVoiceForTest, setSelectedVoiceForTest] = useState("baya");

  const { showNotification } = useAppActions();

  // Загрузка данных при монтировании компонента
  useEffect(() => {
    loadSettings();
    loadModels();
    loadCurrentModel();
  }, []);

  // Функция для разворачивания/сворачивания секций
  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  // Функция для скрытия/показа настроек
  const toggleVisibility = () => {
    setIsVisible(!isVisible);
  };

  // Функция тестирования голоса
  const testVoice = async (voiceName: string) => {
    setIsTestingVoice(true);
    let audioUrl: string | null = null;
    
    try {
      console.log('Тестирую голос:', voiceName);
      
      const response = await fetch(`${API_BASE_URL}/api/voice/synthesize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: `Привет, я Газик И И ${voiceName}.`,
          voice_id: voiceSettings.voice_id,
          voice_speaker: voiceName,
        }),
      });

      if (response.ok) {
        const audioBlob = await response.blob();
        audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        
        console.log('Воспроизведение тестового аудио...');
        
        audio.onended = () => {
          console.log('Тестирование голоса завершено');
          if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
            audioUrl = null;
          }
          setIsTestingVoice(false);
        };
        
        audio.onerror = () => {
          console.error('Ошибка воспроизведения тестового голоса');
          showNotification('error', 'Ошибка воспроизведения тестового голоса');
          if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
            audioUrl = null;
          }
          setIsTestingVoice(false);
        };
        
        await audio.play();
        showNotification('success', `Тестирую голос ${voiceName}...`);
      } else {
        const errorText = await response.text();
        console.error('Ошибка тестирования голоса:', response.status, errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
    } catch (error) {
      console.error('Ошибка тестирования голоса:', error);
      showNotification('error', `Ошибка тестирования голоса: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`);
      
      // Очищаем ресурсы в случае ошибки
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
        audioUrl = null;
      }
      setIsTestingVoice(false);
    }
  };

  // Функция открытия диалога тестирования голоса
  const openVoiceTestDialog = () => {
    setSelectedVoiceForTest(voiceSettings.voice_speaker);
    setShowVoiceTestDialog(true);
  };

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      // Загружаем настройки модели
      const modelResponse = await fetch(`${API_BASE_URL}/api/models/settings`);
      if (modelResponse.ok) {
        const modelData = await modelResponse.json();
        setModelSettings(prev => ({ ...prev, ...modelData }));
      }
      
      // Загружаем настройки голоса
      const voiceResponse = await fetch(`${API_BASE_URL}/api/voice/settings`);
      if (voiceResponse.ok) {
        const voiceData = await voiceResponse.json();
        setVoiceSettings(prev => ({ ...prev, ...voiceData }));
      }
      
      // Загружаем настройки транскрибации
      const transcriptionResponse = await fetch(`${API_BASE_URL}/api/transcription/settings`);
      if (transcriptionResponse.ok) {
        const transcriptionData = await transcriptionResponse.json();
        setTranscriptionSettings(prev => ({ ...prev, ...transcriptionData }));
      }
      
      setSuccess('Настройки загружены');
    } catch (error) {
      console.error('Ошибка загрузки настроек:', error);
      setError('Не удалось загрузить настройки');
    } finally {
      setIsLoading(false);
    }
  };

  const loadModels = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/models`);
      if (response.ok) {
        const data = await response.json();
        setAvailableModels(data.models || []);
      } else {
        setError('Не удалось загрузить список моделей');
      }
    } catch (err) {
      setError(`Ошибка загрузки моделей: ${err}`);
    }
  };

  const loadCurrentModel = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/models/current`);
      if (response.ok) {
        const data = await response.json();
        setCurrentModel(data);
        setSelectedModelPath(data.path || "");
      }
    } catch (err) {
      console.warn('Не удалось загрузить текущую модель:', err);
    }
  };

  const saveSettings = async () => {
    setIsLoading(true);
    try {
      // Сохраняем настройки модели
      const modelResponse = await fetch(`${API_BASE_URL}/api/models/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modelSettings),
      });
      
      if (!modelResponse.ok) {
        throw new Error(`Ошибка сохранения настроек модели: ${modelResponse.status}`);
      }
      
      // Сохраняем настройки голоса
      const voiceResponse = await fetch(`${API_BASE_URL}/api/voice/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(voiceSettings),
      });
      
      if (!voiceResponse.ok) {
        throw new Error(`Ошибка сохранения настроек голоса: ${voiceResponse.status}`);
      }
      
      // Сохраняем настройки транскрибации
      const transcriptionResponse = await fetch(`${API_BASE_URL}/api/transcription/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transcriptionSettings),
      });
      
      if (!transcriptionResponse.ok) {
        throw new Error(`Ошибка сохранения настроек транскрибации: ${transcriptionResponse.status}`);
      }
      
      setSuccess('Настройки сохранены успешно');
      showNotification('success', 'Настройки сохранены');
    } catch (error) {
      console.error('Ошибка сохранения настроек:', error);
      setError(`Ошибка сохранения: ${error}`);
      showNotification('error', 'Ошибка сохранения настроек');
    } finally {
      setIsLoading(false);
    }
  };

  const loadModel = async (modelPath: string) => {
    try {
      setIsLoadingModel(true);
      setError(null);
      
      const response = await fetch(`${API_BASE_URL}/api/models/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_path: modelPath }),
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setSuccess('Модель успешно загружена!');
          showNotification('success', 'Модель загружена');
          setSelectedModelPath(modelPath);
          loadCurrentModel(); // Обновляем информацию о текущей модели
        } else {
          throw new Error(data.message || 'Не удалось загрузить модель');
        }
      } else {
        throw new Error('Ошибка загрузки модели');
      }
      
    } catch (err) {
      setError(`Ошибка загрузки модели: ${err}`);
      showNotification('error', 'Ошибка загрузки модели');
    } finally {
      setIsLoadingModel(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Если страница скрыта, показываем минимизированную версию
  if (!isVisible) {
    return (
      <Container maxWidth="lg" sx={{ mt: 4 }}>
        <Card sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>
            Настройки скрыты
          </Typography>
          <Button
            variant="contained"
            color="primary"
            size="large"
            onClick={toggleVisibility}
            sx={{ minWidth: 200 }}
          >
            Показать настройки
          </Button>
        </Card>
      </Container>
    );
  }

  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Заголовок */}
      <Paper elevation={2} sx={{ p: 2, borderRadius: 0 }}>
        <Container maxWidth="lg">
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Box>
              <Typography variant="h5" fontWeight="600">
                Настройки
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Конфигурация моделей, голоса и других параметров
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <IconButton 
                onClick={toggleExpanded}
                color="primary"
                size="large"
                title={isExpanded ? "Свернуть секции" : "Развернуть секции"}
              >
                {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
              <Button
                variant="outlined"
                color="secondary"
                onClick={toggleVisibility}
                size="small"
              >
                Скрыть
              </Button>
            </Box>
          </Box>
        </Container>
      </Paper>

      {/* Основной контент */}
      <Container maxWidth="lg" sx={{ flexGrow: 1, py: 3, overflow: 'auto' }}>

        {/* Уведомления */}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        
        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        )}

        <Collapse in={isExpanded}>
          {isLoading && <LinearProgress sx={{ mb: 2 }} />}

        {/* Кнопки управления */}
        <Box display="flex" gap={2} mb={3}>
          <Button
            variant="contained"
            color="primary"
            startIcon={<SaveIcon />}
            onClick={saveSettings}
            disabled={isLoading}
          >
            Сохранить настройки
          </Button>
          
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={loadSettings}
            disabled={isLoading}
          >
            Обновить данные
          </Button>
        </Box>

        {/* Настройки модели */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
                              Настройки модели Газик ИИ
            </Typography>
            
            <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(250px, 1fr))" gap={2}>
              <TextField
                label="Размер контекста"
                type="number"
                value={modelSettings.context_size}
                onChange={(e) => setModelSettings(prev => ({ 
                  ...prev, 
                  context_size: parseInt(e.target.value) || 2048 
                }))}
                inputProps={{ min: 512, max: 32768, step: 512 }}
                fullWidth
              />
              
              <TextField
                label="Максимум токенов ответа"
                type="number"
                value={modelSettings.output_tokens}
                onChange={(e) => setModelSettings(prev => ({ 
                  ...prev, 
                  output_tokens: parseInt(e.target.value) || 512 
                }))}
                inputProps={{ min: 64, max: 2048, step: 64 }}
                fullWidth
              />
              
              <TextField
                label="Температура"
                type="number"
                value={modelSettings.temperature}
                onChange={(e) => setModelSettings(prev => ({ 
                  ...prev, 
                  temperature: parseFloat(e.target.value) || 0.7 
                }))}
                inputProps={{ min: 0.1, max: 2.0, step: 0.1 }}
                fullWidth
              />
              
              <TextField
                label="Top-p"
                type="number"
                value={modelSettings.top_p}
                onChange={(e) => setModelSettings(prev => ({ 
                  ...prev, 
                  top_p: parseFloat(e.target.value) || 0.95 
                }))}
                inputProps={{ min: 0.1, max: 1.0, step: 0.05 }}
                fullWidth
              />
              
              <TextField
                label="Штраф за повторения"
                type="number"
                value={modelSettings.repeat_penalty}
                onChange={(e) => setModelSettings(prev => ({ 
                  ...prev, 
                  repeat_penalty: parseFloat(e.target.value) || 1.05 
                }))}
                inputProps={{ min: 1.0, max: 2.0, step: 0.05 }}
                fullWidth
              />
            </Box>
            
            <Box mt={2}>
              <FormControlLabel
                control={
                  <Switch
                    checked={modelSettings.use_gpu}
                    onChange={(e) => setModelSettings(prev => ({ 
                      ...prev, 
                      use_gpu: e.target.checked 
                    }))}
                  />
                }
                label="Использовать GPU"
              />
              
              <FormControlLabel
                control={
                  <Switch
                    checked={modelSettings.streaming}
                    onChange={(e) => setModelSettings(prev => ({ 
                      ...prev, 
                      streaming: e.target.checked 
                    }))}
                  />
                }
                label="Потоковая генерация"
              />
              
              {modelSettings.streaming && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    Скорость потоковой генерации: {modelSettings.streaming_speed}ms
                  </Typography>
                  <input
                    type="range"
                    min="10"
                    max="200"
                    step="10"
                    value={modelSettings.streaming_speed}
                    onChange={(e) => setModelSettings(prev => ({ 
                      ...prev, 
                      streaming_speed: parseInt(e.target.value) 
                    }))}
                    style={{
                      width: '100%',
                      height: '6px',
                      borderRadius: '3px',
                      background: 'linear-gradient(to right, #1976d2 0%, #1976d2 50%, #e0e0e0 50%, #e0e0e0 100%)',
                      outline: 'none',
                      WebkitAppearance: 'none',
                    }}
                  />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      Быстро (10ms)
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Медленно (200ms)
                    </Typography>
                  </Box>
                </Box>
              )}
            </Box>
          </CardContent>
        </Card>

        {/* Управление моделями */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Управление моделями
            </Typography>
            
            {/* Информация о текущей модели */}
            {currentModel?.loaded ? (
              <Box sx={{ mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <ComputerIcon color="primary" />
                  <Chip label="Загружена" color="success" size="small" />
                </Box>
                <Typography variant="body1" fontWeight="500" gutterBottom>
                  {currentModel.metadata?.['general.name'] || 'Неизвестная модель'}
                </Typography>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Архитектура: {currentModel.metadata?.['general.architecture'] || 'Неизвестно'}
                </Typography>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Контекст: {currentModel.n_ctx || 'Неизвестно'} токенов
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Путь: {currentModel.path}
                </Typography>
              </Box>
            ) : (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Модель не загружена
              </Alert>
            )}
            
            <Button
              variant="outlined"
              startIcon={<UploadIcon />}
              onClick={() => setShowModelDialog(true)}
              disabled={isLoadingModel}
              fullWidth
            >
              {isLoadingModel ? 'Загрузка модели...' : 'Сменить модель'}
            </Button>
          </CardContent>
        </Card>

        {/* Настройки голоса */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Настройки голоса
            </Typography>
            
            <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(250px, 1fr))" gap={2}>
              <FormControl fullWidth>
                <InputLabel>Язык голоса</InputLabel>
                <Select
                  value={voiceSettings.voice_id}
                  label="Язык голоса"
                  onChange={(e) => setVoiceSettings(prev => ({ 
                    ...prev, 
                    voice_id: e.target.value 
                  }))}
                >
                  <MenuItem value="ru">Русский</MenuItem>
                  <MenuItem value="en">English</MenuItem>
                </Select>
              </FormControl>
              
              <FormControl fullWidth>
                <InputLabel>Голос для синтеза</InputLabel>
                <Select
                  value={voiceSettings.voice_speaker}
                  label="Голос для синтеза"
                  onChange={(e) => setVoiceSettings(prev => ({ 
                    ...prev, 
                    voice_speaker: e.target.value 
                  }))}
                >
                  <MenuItem value="baya">Baya (женский)</MenuItem>
                  <MenuItem value="xenia">Xenia (женский)</MenuItem>
                  <MenuItem value="kseniya">Kseniya (женский)</MenuItem>
                  <MenuItem value="aidar">Aidar (мужской)</MenuItem>
                  <MenuItem value="eugene">Eugene (мужской)</MenuItem>
                </Select>
              </FormControl>
              
              <TextField
                label="Скорость речи"
                type="number"
                value={voiceSettings.speech_rate}
                onChange={(e) => setVoiceSettings(prev => ({ 
                  ...prev, 
                  speech_rate: parseFloat(e.target.value) || 1.0 
                }))}
                inputProps={{ min: 0.5, max: 2.0, step: 0.1 }}
                fullWidth
              />
            </Box>
            
            {/* Кнопка тестирования голоса */}
            <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
              <Button
                variant="outlined"
                onClick={openVoiceTestDialog}
                disabled={isTestingVoice}
                startIcon={<VolumeUpIcon />}
              >
                {isTestingVoice ? 'Тестирую...' : 'Тестировать голос'}
              </Button>
              
              {isTestingVoice && (
                <CircularProgress size={20} />
              )}
            </Box>
          </CardContent>
        </Card>

        {/* Настройки транскрибации */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Настройки транскрибации
            </Typography>
            
            <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(250px, 1fr))" gap={2}>
              <FormControl fullWidth>
                <InputLabel>Движок транскрибации</InputLabel>
                <Select
                  value={transcriptionSettings.engine}
                  label="Движок транскрибации"
                  onChange={(e) => setTranscriptionSettings(prev => ({ 
                    ...prev, 
                    engine: e.target.value as "whisperx" | "vosk"
                  }))}
                >
                  <MenuItem value="whisperx">WhisperX (точный, медленный)</MenuItem>
                  <MenuItem value="vosk">Vosk (быстрый, менее точный)</MenuItem>
                </Select>
              </FormControl>
              
              <FormControl fullWidth>
                <InputLabel>Язык транскрибации</InputLabel>
                <Select
                  value={transcriptionSettings.language}
                  label="Язык транскрибации"
                  onChange={(e) => setTranscriptionSettings(prev => ({ 
                    ...prev, 
                    language: e.target.value 
                  }))}
                >
                  <MenuItem value="ru">Русский</MenuItem>
                  <MenuItem value="en">English</MenuItem>
                  <MenuItem value="auto">Автоопределение</MenuItem>
                </Select>
              </FormControl>
            </Box>
            
            <Box mt={2}>
              <FormControlLabel
                control={
                  <Switch
                    checked={transcriptionSettings.auto_detect}
                    onChange={(e) => setTranscriptionSettings(prev => ({ 
                      ...prev, 
                      auto_detect: e.target.checked 
                    }))}
                  />
                }
                label="Автоматическое определение языка"
              />
            </Box>
          </CardContent>
        </Card>

        {/* Системная информация */}
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Системная информация
            </Typography>
            
            <Box display="grid" gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={2}>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Версия веб-приложения
                </Typography>
                <Typography variant="body1">
                  Web Interface v1.0.3
                </Typography>
              </Box>
              
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Платформа
                </Typography>
                <Typography variant="body1">
                  {navigator.platform || 'Неизвестно'}
                </Typography>
              </Box>
              
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Браузер
                </Typography>
                <Typography variant="body1">
                  {navigator.userAgent.split(' ')[0] || 'Неизвестно'}
                </Typography>
              </Box>
              
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Backend
                </Typography>
                <Typography variant="body1">
                  FastAPI + Python
                </Typography>
              </Box>
              
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Frontend
                </Typography>
                <Typography variant="body1">
                  React + TypeScript
                </Typography>
              </Box>
              
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  Соединение
                </Typography>
                <Typography variant="body1">
                  Socket.IO
                </Typography>
              </Box>
            </Box>
          </CardContent>
        </Card>
        </Collapse>
      </Container>

      {/* Диалог выбора модели */}
      <Dialog
        open={showModelDialog}
        onClose={() => setShowModelDialog(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Выбор модели</DialogTitle>
        <DialogContent>
          {availableModels.length === 0 ? (
            <Alert severity="info">
              Модели не найдены. Поместите GGUF файлы в директорию models/
            </Alert>
          ) : (
            <List>
              {availableModels.map((model, index) => (
                <ListItem
                  key={index}
                  component="div"
                  sx={{ 
                    cursor: 'pointer',
                    borderRadius: 1,
                    '&:hover': { backgroundColor: 'action.hover' },
                    backgroundColor: selectedModelPath === model.path ? 'action.selected' : 'transparent',
                    border: selectedModelPath === model.path ? '2px solid #1976d2' : '1px solid transparent',
                    mb: 1,
                  }}
                  onClick={() => setSelectedModelPath(model.path)}
                >
                  <ListItemText
                    primary={model.name}
                    secondary={
                      <Box>
                        <Typography variant="caption" display="block">
                          Размер: {formatFileSize(model.size)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {model.path}
                        </Typography>
                      </Box>
                    }
                  />
                </ListItem>
              ))}
            </List>
          )}
          
          {isLoadingModel && <LinearProgress sx={{ mt: 2 }} />}
        </DialogContent>
        <DialogActions>
          <Button 
            onClick={() => setShowModelDialog(false)} 
            disabled={isLoadingModel}
          >
            Отмена
          </Button>
          <Button
            onClick={() => {
              if (selectedModelPath) {
                loadModel(selectedModelPath);
                setShowModelDialog(false);
              }
            }}
            disabled={!selectedModelPath || isLoadingModel}
            variant="contained"
          >
            {isLoadingModel ? 'Загрузка...' : 'Загрузить модель'}
          </Button>
        </DialogActions>
      </Dialog>
      
      {/* Диалог тестирования голоса */}
      <Dialog 
        open={showVoiceTestDialog} 
        onClose={() => setShowVoiceTestDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Тестирование голоса
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            Выберите голос для тестирования и нажмите кнопку воспроизведения
          </Typography>
          
          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Голос для тестирования</InputLabel>
            <Select
              value={selectedVoiceForTest}
              label="Голос для тестирования"
              onChange={(e) => setSelectedVoiceForTest(e.target.value)}
            >
              <MenuItem value="baya">Baya (женский)</MenuItem>
              <MenuItem value="xenia">Xenia (женский)</MenuItem>
              <MenuItem value="kseniya">Kseniya (женский)</MenuItem>
              <MenuItem value="aidar">Aidar (мужской)</MenuItem>
              <MenuItem value="eugene">Eugene (мужской)</MenuItem>
            </Select>
          </FormControl>
          
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Button
              variant="contained"
              onClick={() => testVoice(selectedVoiceForTest)}
              disabled={isTestingVoice}
              startIcon={<VolumeUpIcon />}
            >
              {isTestingVoice ? 'Воспроизвожу...' : 'Воспроизвести'}
            </Button>
            
            {isTestingVoice && (
              <CircularProgress size={20} />
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowVoiceTestDialog(false)}>
            Закрыть
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

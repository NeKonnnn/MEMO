import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  TextField,
  IconButton,
  Typography,
  Container,
  Card,
  CardContent,
  Avatar,
  Chip,
  Fab,
  Tooltip,
  LinearProgress,
  Alert,
  Snackbar,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Slider,
  CircularProgress,
  Fade,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Menu,
} from '@mui/material';
import {
  Send as SendIcon,
  Person as PersonIcon,
  SmartToy as BotIcon,
  Clear as ClearIcon,
  ContentCopy as CopyIcon,
  Stop as StopIcon,
  Refresh as RefreshIcon,
  Mic as MicIcon,
  VolumeUp as VolumeUpIcon,
  AttachFile as AttachFileIcon,
  Close as CloseIcon,
  Upload as UploadIcon,
  Description as DocumentIcon,
  PictureAsPdf as PdfIcon,
  TableChart as ExcelIcon,
  Delete as DeleteIcon,
  GetApp as DownloadIcon,
  Settings as SettingsIcon,
  Square as SquareIcon,
} from '@mui/icons-material';
import { useAppContext, useAppActions, Message } from '../contexts/AppContext';
import { useSocket } from '../contexts/SocketContext';
import { getApiUrl } from '../config/api';
import MessageRenderer from '../components/MessageRenderer';

interface UnifiedChatPageProps {
  isDarkMode: boolean;
}

export default function UnifiedChatPage({ isDarkMode }: UnifiedChatPageProps) {
  // Состояние для текстового чата
  const [inputMessage, setInputMessage] = useState('');
  const [showCopyAlert, setShowCopyAlert] = useState(false);
  
  // Состояние для голосового чата
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [recordedText, setRecordedText] = useState('');
  const [recordingTime, setRecordingTime] = useState(0);
  const [voiceSettings, setVoiceSettings] = useState({
    voice_id: 'ru',
    speech_rate: 1.0,
    voice_speaker: 'baya',
  });
  const [showVoiceDialog, setShowVoiceDialog] = useState(false);
  
  // Состояние для документов
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [query, setQuery] = useState('');
  const [isQuerying, setIsQuerying] = useState(false);
  const [queryResponse, setQueryResponse] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<Array<{
    name: string;
    size: number;
    type: string;
    uploadDate: string;
  }>>([]);
  const [showDocumentDialog, setShowDocumentDialog] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  
  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Загружаем список документов при инициализации
  useEffect(() => {
    const loadDocuments = async () => {
      try {
        const response = await fetch(getApiUrl('/api/documents'));
        if (response.ok) {
          const result: any = await response.json();
          if (result.success && result.documents) {
            // Преобразуем список имен файлов в объекты файлов
            const files = result.documents.map((filename: string) => ({
              name: filename,
              size: 0, // Размер не сохраняется на бэкенде
              type: 'application/octet-stream', // Тип не сохраняется на бэкенде
              uploadDate: new Date().toISOString(),
            }));
            setUploadedFiles(files);
          }
        }
      } catch (error) {
        console.error('Ошибка при загрузке списка документов:', error);
      }
    };

    loadDocuments();
  }, []);
  const animationFrameRef = useRef<number | null>(null);
  const currentStreamRef = useRef<MediaStream | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastAudioLevelRef = useRef<number>(0);
  
  // Константы
  const silenceThreshold = 0.1;
  const silenceTimeout = 5000;
  
  // Context и Socket
  const { state } = useAppContext();
  const { clearMessages, showNotification, setSpeaking, setRecording } = useAppActions();
  const { sendMessage, isConnected, reconnect, stopGeneration } = useSocket();

  // Автоскролл к последнему сообщению
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.messages]);

  // Фокус на поле ввода при загрузке
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ================================
  // ФУНКЦИИ ТЕКСТОВОГО ЧАТА
  // ================================

  const handleSendMessage = (): void => {
    if (!inputMessage.trim() || !isConnected || state.isLoading) {
      return;
    }

    sendMessage(inputMessage.trim());
    setInputMessage('');
  };

  const handleKeyPress = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  const handleCopyMessage = async (content: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content);
      setShowCopyAlert(true);
    } catch (error) {
      showNotification('error', 'Не удалось скопировать текст');
    }
  };

  const formatTimestamp = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // ================================
  // ФУНКЦИИ ГОЛОСОВОГО ЧАТА
  // ================================

  const startRecording = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      currentStreamRef.current = stream;
      
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      
      const analyser = audioContext.createAnalyser();
      analyserRef.current = analyser;
      
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      
      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      const updateAudioLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b) / bufferLength;
        const level = average / 255;
        setAudioLevel(level);
        
        // Проверка тишины
        if (level < silenceThreshold) {
          if (!silenceTimerRef.current) {
            silenceTimerRef.current = setTimeout(() => {
              stopRecording();
            }, silenceTimeout);
          }
        } else {
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        }
        
        lastAudioLevelRef.current = level;
        animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
      };
      
      updateAudioLevel();
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      // Таймер записи
      const timer = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      
      mediaRecorder.onstop = async () => {
        clearInterval(timer);
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        await processAudio(audioBlob);
        cleanupVoiceResources();
      };
      
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      setRecording(true);
      
    } catch (error) {
      console.error('Ошибка при запуске записи:', error);
      showNotification('error', 'Не удалось запустить запись микрофона');
    }
  };

  const stopRecording = (): void => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    setRecording(false);
  };

  const processAudio = async (audioBlob: Blob): Promise<void> => {
    setIsProcessing(true);
    
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob);
      
      const response = await fetch(`${getApiUrl('/api/voice/recognize')}`, {
        method: 'POST',
        body: formData,
      });
      
      if (response.ok) {
        const result: any = await response.json();
        if (result.success && result.text) {
          setRecordedText(result.text);
          // Автоматически отправляем распознанный текст
          sendMessage(result.text);
        } else {
          showNotification('error', result.error || 'Не удалось распознать речь');
        }
      } else {
        showNotification('error', 'Ошибка при распознавании речи');
      }
    } catch (error) {
      console.error('Ошибка при обработке аудио:', error);
      showNotification('error', 'Ошибка при обработке аудио');
    } finally {
      setIsProcessing(false);
    }
  };

  const cleanupVoiceResources = (): void => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }
    
    if (currentStreamRef.current) {
      currentStreamRef.current.getTracks().forEach(track => track.stop());
      currentStreamRef.current = null;
    }
    
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    
    audioChunksRef.current = [];
    setAudioLevel(0);
  };

  // ================================
  // ФУНКЦИИ РАБОТЫ С ДОКУМЕНТАМИ
  // ================================

  const handleFileUpload = async (file: File): Promise<void> => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/plain',
    ];

    if (!allowedTypes.includes(file.type)) {
      showNotification('error', 'Поддерживаются только файлы PDF, Word (.docx), Excel (.xlsx) и TXT');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      showNotification('error', 'Размер файла не должен превышать 50MB');
      return;
    }

    setIsUploading(true);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch(`${getApiUrl('/api/documents/upload')}`, {
        method: 'POST',
        body: formData,
      });
      
      if (response.ok) {
        const result: any = await response.json();
        showNotification('success', `Документ "${file.name}" успешно загружен. Теперь вы можете задать вопрос по нему в чате.`);
        
        // Добавляем файл в список
        setUploadedFiles(prev => [...prev, {
          name: file.name,
          size: file.size,
          type: file.type,
          uploadDate: new Date().toISOString(),
        }]);
        
        // Обновляем список документов с бэкенда
        try {
          const docsResponse = await fetch(getApiUrl('/api/documents'));
          if (docsResponse.ok) {
            const docsResult: any = await docsResponse.json();
            if (docsResult.success && docsResult.documents) {
              const files = docsResult.documents.map((filename: string) => ({
                name: filename,
                size: 0,
                type: 'application/octet-stream',
                uploadDate: new Date().toISOString(),
              }));
              setUploadedFiles(files);
            }
          }
        } catch (error) {
          console.error('Ошибка при обновлении списка документов:', error);
        }
        
        // Очищаем input файла, чтобы можно было повторно загрузить тот же файл
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        
      } else {
        const error = await response.json();
        showNotification('error', error.detail || 'Ошибка при загрузке документа');
      }
    } catch (error) {
      console.error('Ошибка при загрузке файла:', error);
      showNotification('error', 'Ошибка при загрузке файла');
            } finally {
      setIsUploading(false);
    }
  };

  const handleFileDelete = async (fileName: string): Promise<void> => {
    try {
      const response = await fetch(`${getApiUrl(`/api/documents/${encodeURIComponent(fileName)}`)}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        const result: any = await response.json();
        // Обновляем список документов с бэкенда
        if (result.remaining_documents) {
          const files = result.remaining_documents.map((filename: string) => ({
            name: filename,
            size: 0,
            type: 'application/octet-stream',
            uploadDate: new Date().toISOString(),
          }));
          setUploadedFiles(files);
        } else {
          setUploadedFiles(prev => prev.filter(file => file.name !== fileName));
        }
        showNotification('success', `Документ "${fileName}" удален`);
        
        // Очищаем input файла после удаления
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        
      } else {
        const error = await response.json();
        showNotification('error', error.detail || 'Ошибка при удалении документа');
      }
    } catch (error) {
      console.error('Ошибка при удалении файла:', error);
      showNotification('error', 'Ошибка при удалении файла');
    }
  };

  const handleDragOver = (e: React.DragEvent): void => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent): void => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>): void => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = (): void => {
    setAnchorEl(null);
  };

  const handleClearChat = (): void => {
    clearMessages();
    handleMenuClose();
  };

  const handleReconnect = (): void => {
    reconnect();
    handleMenuClose();
  };

  const handleStopGeneration = (): void => {
    // Останавливаем генерацию через WebSocket
    stopGeneration();
    showNotification('info', 'Генерация остановлена');
  };

  // ================================
  // КОМПОНЕНТЫ СООБЩЕНИЙ
  // ================================

    const MessageCard = ({ message }: { message: Message }): React.ReactElement => {
    const isUser = message.role === 'user';
    const [isHovered, setIsHovered] = useState(false);
    
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: isUser ? 'flex-end' : 'flex-start',
          mb: 1.5, /* Увеличиваем отступ между сообщениями (соответствует CSS margin-bottom: 28px) */
          width: '100%',
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <Card
          className="message-bubble"
          data-theme={isDarkMode ? 'dark' : 'light'}
          sx={{
            maxWidth: '75%',
            minWidth: '180px',
            backgroundColor: isUser 
              ? 'primary.main' 
              : isDarkMode ? 'background.paper' : '#f8f9fa',
            color: isUser ? 'primary.contrastText' : isDarkMode ? 'text.primary' : '#333',
            boxShadow: isDarkMode 
              ? '0 2px 8px rgba(0, 0, 0, 0.15)' 
              : '0 2px 8px rgba(0, 0, 0, 0.1)',
          }}
        >
          <CardContent sx={{ p: 1.2, pb: 0.8 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.3 }}>
              <Avatar
                sx={{
                  width: 24,
                  height: 24,
                  mr: 1,
                  bgcolor: isUser ? 'primary.dark' : 'secondary.main',
                }}
              >
                {isUser ? <PersonIcon /> : <BotIcon />}
              </Avatar>
                             <Typography variant="caption" sx={{ opacity: 0.8, fontSize: '0.75rem', fontWeight: 500 }}>
                 {isUser ? 'Вы' : 'Газик ИИ'}
               </Typography>
              <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6, fontSize: '0.7rem' }}>
                {formatTimestamp(message.timestamp)}
              </Typography>
            </Box>
            
            <Box sx={{ mb: 0.3 }}>
              <MessageRenderer content={message.content} />
            </Box>
          </CardContent>
        </Card>
        
        {/* Кнопка копирования снизу карточки - для всех сообщений при наведении */}
        <Box sx={{ 
          display: 'flex', 
          justifyContent: 'center',
          mt: 1,
          height: 20, /* Фиксированная высота для кнопки */
          opacity: isHovered ? 1 : 0, /* Мгновенное появление/исчезновение */
          visibility: isHovered ? 'visible' : 'hidden', /* Скрываем кнопку, но сохраняем место */
        }}>
          <Tooltip title="Копировать">
            <IconButton
              size="small"
              onClick={() => handleCopyMessage(message.content)}
              className="message-copy-button"
              data-theme={isDarkMode ? 'dark' : 'light'}
                             sx={{ 
                 opacity: 0.7,
                 p: 0.5,
                 /* Убираем hover эффекты, чтобы кнопка была статичной */
               }}
            >
              <CopyIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    );
  };

  // ================================
  // ДИАЛОГИ
  // ================================

  const VoiceDialog = (): React.ReactElement => (
    <Dialog
      open={showVoiceDialog}
      onClose={() => setShowVoiceDialog(false)}
      maxWidth="sm"
      fullWidth
      TransitionComponent={undefined}
      transitionDuration={0}
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          borderRadius: 3,
        }
      }}
    >
      <DialogTitle sx={{ textAlign: 'center', pb: 1 }}>
        Голосовой чат
      </DialogTitle>
      <DialogContent sx={{ textAlign: 'center', py: 3 }}>
        {!isRecording ? (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Нажмите кнопку микрофона для начала записи
            </Typography>
            <IconButton
              size="large"
              onClick={startRecording}
              disabled={state.isLoading && !state.messages.some(msg => msg.isStreaming)}
              sx={{
                width: 80,
                height: 80,
                bgcolor: 'primary.main',
                color: 'white',
                '&:hover': { bgcolor: 'primary.dark' },
                '&:disabled': {
                  bgcolor: 'action.disabledBackground',
                  color: 'action.disabled',
                },
              }}
            >
              <MicIcon sx={{ fontSize: 40 }} />
            </IconButton>
          </Box>
        ) : (
          <Box>
            <Box
              sx={{
                width: 120,
                height: 120,
                borderRadius: '50%',
                bgcolor: 'primary.main',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 2,
                animation: 'pulse 1.5s ease-in-out infinite',
                '@keyframes pulse': {
                  '0%': { transform: 'scale(1)', opacity: 1 },
                  '50%': { transform: 'scale(1.1)', opacity: 0.8 },
                  '100%': { transform: 'scale(1)', opacity: 1 },
                },
              }}
            >
              <MicIcon sx={{ fontSize: 60, color: 'white' }} />
            </Box>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Запись... {Math.floor(recordingTime / 60)}:{(recordingTime % 60).toString().padStart(2, '0')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Уровень звука: {Math.round(audioLevel * 100)}%
            </Typography>
            <LinearProgress 
              variant="determinate" 
              value={audioLevel * 100} 
              sx={{ mb: 2 }}
            />
            <Button
              variant="contained"
              color="error"
              onClick={stopRecording}
              startIcon={<StopIcon />}
            >
              Остановить запись
            </Button>
          </Box>
        )}
        
        {isProcessing && (
          <Box sx={{ mt: 2 }}>
            <CircularProgress size={24} sx={{ mr: 1 }} />
            <Typography variant="body2">Обработка аудио...</Typography>
          </Box>
        )}
        
        {recordedText && (
          <Box sx={{ mt: 2, p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Распознанный текст:
            </Typography>
            <Typography variant="body1">{recordedText}</Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'center', pb: 3 }}>
        <Button onClick={() => setShowVoiceDialog(false)}>
          Закрыть
        </Button>
      </DialogActions>
    </Dialog>
  );

  const DocumentDialog = (): React.ReactElement => (
    <Dialog
      open={showDocumentDialog}
      onClose={() => setShowDocumentDialog(false)}
      maxWidth="md"
      fullWidth
      TransitionComponent={undefined}
      transitionDuration={0}
    >
      <DialogTitle>Загрузка документов</DialogTitle>
      <DialogContent>
        <Box
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          sx={{
            border: '2px dashed',
            borderColor: isDragging ? 'primary.main' : 'divider',
            borderRadius: 2,
            p: 4,
            textAlign: 'center',
            bgcolor: isDragging ? 'action.hover' : 'background.paper',
            cursor: 'pointer',
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <UploadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" sx={{ mb: 1 }}>
            Перетащите файл сюда или нажмите для выбора
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Поддерживаются PDF, Word, Excel и текстовые файлы до 50MB
          </Typography>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.xlsx,.txt"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
        </Box>
        

      </DialogContent>
      <DialogActions>
        <Button onClick={() => setShowDocumentDialog(false)}>
          Закрыть
        </Button>
      </DialogActions>
    </Dialog>
  );

  // ================================
  // ОСНОВНОЙ РЕНДЕР
  // ================================

  return (
    <Box 
      className="fullscreen-chat" 
      sx={{ 
        pt: 8,
        background: isDarkMode 
          ? 'linear-gradient(135deg, #1e1e1e 0%, #2d2d2d 50%, #1a1a1a 100%)'
          : 'linear-gradient(135deg, #f5f5f5 0%, #ffffff 50%, #fafafa 100%)',
        color: isDarkMode ? 'white' : '#333',
      }}
    >
      {/* Область сообщений */}
      <Box
        className="chat-messages-area"
                 sx={{
           border: isDragging ? '2px dashed' : 'none',
           borderColor: isDragging ? 'primary.main' : 'transparent',
           bgcolor: isDragging ? 'action.hover' : 'transparent',
           position: 'relative',
           minHeight: '60vh',
           display: 'flex',
           flexDirection: 'column',
           justifyContent: state.messages.length === 0 ? 'center' : 'flex-start',
           alignItems: 'center',
           py: 4,
         }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
          {state.messages.length === 0 ? (
                         <Box
               sx={{
                 display: 'flex',
                 flexDirection: 'column',
                 alignItems: 'center',
                 justifyContent: 'center',
                 textAlign: 'center',
                 color: isDarkMode ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)',
                 maxWidth: '600px',
                 mx: 'auto',
               }}
             >
               <BotIcon sx={{ fontSize: 64, mb: 2, opacity: 0.7, color: '#2196f3' }} />
                               <Typography variant="h6" sx={{ mb: 1, color: isDarkMode ? 'white' : '#333' }}>
                  Добро пожаловать в Газик ИИ!
                </Typography>
               <Typography variant="body1" sx={{ color: isDarkMode ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.9)' }}>
                 Задайте вопрос, загрузите документ или используйте голосовой ввод
               </Typography>
               <Typography variant="body2" sx={{ mt: 2, opacity: 0.7, color: isDarkMode ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)' }}>
                 Перетащите файл сюда для загрузки
               </Typography>
             </Box>
          ) : (
            <Box sx={{ 
              width: '100%', 
              maxWidth: '800px', 
              mx: 'auto',
              px: 2,
            }}>
              {state.messages.map((message, index) => (
                <MessageCard key={index} message={message} />
              ))}
            </Box>
          )}
          <div ref={messagesEndRef} />
          
          {/* Подсказка о перетаскивании в области сообщений */}
          {isDragging && (
            <Box
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                bgcolor: 'rgba(33, 150, 243, 0.9)',
                backdropFilter: 'blur(10px)',
                color: 'white',
                p: 3,
                borderRadius: 2,
                zIndex: 1000,
                textAlign: 'center',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
              }}
            >
              <UploadIcon sx={{ fontSize: 48, mb: 2 }} />
              <Typography variant="h6">
                Отпустите файл для загрузки
              </Typography>
            </Box>
          )}
        </Box>

                 {/* Индикатор размышления - показывается только до начала потоковой генерации */}
         {state.isLoading && !state.messages.some(msg => msg.isStreaming) && (
           <Box sx={{ 
             width: '100%', 
             maxWidth: '800px', 
             mx: 'auto',
             px: 2,
             mb: 3,
           }}>
             <Box
               sx={{
                 display: 'flex',
                 flexDirection: 'column',
                 alignItems: 'flex-start',
                 maxWidth: '75%',
                 minWidth: '180px',
               }}
             >
               <Card
                 sx={{
                   backgroundColor: isDarkMode ? 'background.paper' : '#f8f9fa',
                   color: isDarkMode ? 'text.primary' : '#333',
                   boxShadow: isDarkMode 
                     ? '0 2px 8px rgba(0, 0, 0, 0.15)' 
                     : '0 2px 8px rgba(0, 0, 0, 0.1)',
                   width: '100%',
                 }}
               >
                 <CardContent sx={{ p: 1.2, pb: 0.8 }}>
                   <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.3 }}>
                     <Avatar
                       sx={{
                         width: 24,
                         height: 24,
                         mr: 1,
                         bgcolor: 'secondary.main',
                         position: 'relative',
                         '&::before': {
                           content: '""',
                           position: 'absolute',
                           top: '-2px',
                           left: '-2px',
                           right: '-2px',
                           bottom: '-2px',
                           borderRadius: '50%',
                           background: 'radial-gradient(circle, rgba(33, 150, 243, 0.3) 0%, transparent 70%)',
                           animation: 'thinking-glow 2s ease-in-out infinite',
                           '@keyframes thinking-glow': {
                             '0%, 100%': { 
                               opacity: 0.3,
                               transform: 'scale(1)',
                             },
                             '50%': { 
                               opacity: 0.8,
                               transform: 'scale(1.3)',
                             },
                           },
                         },
                         animation: 'thinking 2s ease-in-out infinite',
                       }}
                     >
                       <BotIcon />
                     </Avatar>
                     <Typography variant="caption" sx={{ opacity: 0.8, fontSize: '0.75rem', fontWeight: 500 }}>
                       Газик ИИ
                     </Typography>
                     <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6, fontSize: '0.7rem' }}>
                       {new Date().toLocaleTimeString('ru-RU', {
                         hour: '2-digit',
                         minute: '2-digit',
                       })}
                     </Typography>
                   </Box>
                   
                   <Box sx={{ 
                     display: 'flex', 
                     alignItems: 'center', 
                     gap: 1,
                     minHeight: '24px',
                   }}>
                     <Box sx={{ display: 'flex', gap: 0.5 }}>
                       <Box
                         sx={{
                           width: 6,
                           height: 6,
                           borderRadius: '50%',
                           bgcolor: '#2196f3',
                           animation: 'dot1 1.4s ease-in-out infinite both',
                           '@keyframes dot1': {
                             '0%, 80%, 100%': { transform: 'scale(0)' },
                             '40%': { transform: 'scale(1)' },
                           },
                         }}
                       />
                       <Box
                         sx={{
                           width: 6,
                           height: 6,
                           borderRadius: '50%',
                           bgcolor: '#2196f3',
                           animation: 'dot2 1.4s ease-in-out infinite both',
                           animationDelay: '0.2s',
                           '@keyframes dot2': {
                             '0%, 80%, 100%': { transform: 'scale(0)' },
                             '40%': { transform: 'scale(1)' },
                           },
                         }}
                       />
                       <Box
                         sx={{
                           width: 6,
                           height: 6,
                           borderRadius: '50%',
                           bgcolor: '#2196f3',
                           animation: 'dot3 1.4s ease-in-out infinite both',
                           animationDelay: '0.4s',
                           '@keyframes dot3': {
                             '0%, 80%, 100%': { transform: 'scale(0)' },
                             '40%': { transform: 'scale(1)' },
                           },
                         }}
                       />
                     </Box>
                     <Typography variant="body2" sx={{ 
                       color: isDarkMode ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)',
                       fontSize: '0.875rem',
                     }}>
                       думает...
                     </Typography>
                   </Box>
                 </CardContent>
               </Card>
             </Box>
           </Box>
         )}

                 {/* Поле ввода */}
         <Box
           className="chat-input-area"
           data-theme={isDarkMode ? 'dark' : 'light'}
                       sx={{
              borderColor: isDragging ? 'primary.main' : 'divider',
              bgcolor: isDragging ? 'action.hover' : 'transparent',
            }}
           onDragOver={handleDragOver}
           onDragLeave={handleDragLeave}
           onDrop={handleDrop}
         >
          {/* Загруженные файлы */}
          {uploadedFiles.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {uploadedFiles.map((file, index) => (
                  <Box
                    key={index}
                    className="file-attachment"
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      p: 1,
                      borderRadius: 2,
                      maxWidth: '300px',
                    }}
                  >
                    <Box
                      sx={{
                        width: 32,
                        height: 32,
                        borderRadius: 1,
                        bgcolor: 'rgba(255, 255, 255, 0.2)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        flexShrink: 0,
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                      }}
                    >
                      {file.type.includes('pdf') ? <PdfIcon fontSize="small" /> : 
                       file.type.includes('word') ? <DocumentIcon fontSize="small" /> : 
                       file.type.includes('excel') ? <DocumentIcon fontSize="small" /> : <DocumentIcon fontSize="small" />}
                    </Box>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography 
                        variant="caption" 
                        sx={{ 
                          fontWeight: 'medium', 
                          display: 'block', 
                          color: 'white',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                        title={file.name}
                      >
                        {file.name}
                      </Typography>
                    </Box>
                    <IconButton
                      size="small"
                      onClick={() => handleFileDelete(file.name)}
                      sx={{ 
                        color: 'rgba(255, 255, 255, 0.7)',
                        '&:hover': { 
                          color: '#ff6b6b',
                          bgcolor: 'rgba(255, 107, 107, 0.2)',
                        },
                        p: 0.5,
                        borderRadius: 1,
                        flexShrink: 0,
                      }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
          
          {/* Индикатор загрузки файла в поле ввода */}
          {isUploading && (
            <Box sx={{ mb: 2, p: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={16} sx={{ color: 'white' }} />
                <Typography variant="caption" sx={{ color: 'white' }}>
                  Загрузка документа...
                </Typography>
              </Box>
            </Box>
          )}
          
          {/* Подсказка о перетаскивании */}
          {isDragging && (
            <Box sx={{ mb: 2, p: 2, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: 'white' }}>
                Отпустите файл для загрузки
              </Typography>
            </Box>
          )}

          
          
                     {/* Объединенное поле ввода с кнопками */}
           <Box
             sx={{
               mt: 2,
               p: 2,
               borderRadius: 2,
               bgcolor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
               border: `1px solid ${isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}`,
               maxWidth: '800px', // Расширяем до ширины карточек сообщений
               width: '100%', // Занимает всю доступную ширину до maxWidth
               mx: 'auto', // Центрируем по горизонтали
             }}
           >
             {/* Поле ввода текста сверху */}
             <TextField
               ref={inputRef}
               fullWidth
               multiline
               maxRows={4}
               value={inputMessage}
               onChange={(e) => setInputMessage(e.target.value)}
               onKeyPress={handleKeyPress}
               placeholder={
                 !isConnected 
                   ? "Нет соединения с сервером. Запустите backend на порту 8000" 
                   : state.isLoading && !state.messages.some(msg => msg.isStreaming)
                     ? "ГазикИИ думает..." 
                     : state.isLoading && state.messages.some(msg => msg.isStreaming)
                       ? "ГазикИИ генерирует ответ... Нажмите ⏹️ чтобы остановить"
                       : "Чем я могу помочь вам сегодня?"
               }
               variant="outlined"
               size="small"
               disabled={!isConnected || (state.isLoading && !state.messages.some(msg => msg.isStreaming))}
               sx={{
                 mb: 2,
                 '& .MuiOutlinedInput-root': {
                   bgcolor: 'transparent',
                   border: 'none',
                   '&:hover': {
                     bgcolor: 'transparent',
                   },
                   '&.Mui-focused': {
                     bgcolor: 'transparent',
                   }
                 }
               }}
             />

             {/* Скрытый input для выбора файла */}
             <input
               ref={fileInputRef}
               type="file"
               accept=".pdf,.docx,.xlsx,.txt"
               onChange={handleFileSelect}
               style={{ display: 'none' }}
             />

                           {/* Кнопки снизу */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  justifyContent: 'space-between',
                }}
              >
                                 {/* Левая группа кнопок */}
                 <Box sx={{ display: 'flex', gap: 1 }}>
                   {/* Кнопка загрузки документов */}
                   <Tooltip title="Загрузить документ">
                     <IconButton
                       onClick={() => fileInputRef.current?.click()}
                       sx={{ 
                         color: '#2196f3',
                         bgcolor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                         '&:hover': {
                           bgcolor: isDarkMode ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)',
                         },
                         '&:active': {
                           transform: 'none',
                         }
                       }}
                       disableRipple
                       disabled={isUploading || (state.isLoading && !state.messages.some(msg => msg.isStreaming))}
                     >
                       {isUploading ? <CircularProgress size={20} /> : <AttachFileIcon sx={{ color: '#2196f3' }} />}
                     </IconButton>
                   </Tooltip>

                                       {/* Кнопка меню с шестеренкой */}
                    <Tooltip title="Дополнительные действия">
                      <IconButton
                        onClick={handleMenuOpen}
                        disabled={state.isLoading && !state.messages.some(msg => msg.isStreaming)}
                        sx={{ 
                          color: isDarkMode ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.7)',
                          bgcolor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
                          '&:hover': {
                            bgcolor: isDarkMode ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)',
                          },
                          '&:disabled': {
                            color: isDarkMode ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.3)',
                            bgcolor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
                          }
                        }}
                      >
                        <SettingsIcon />
                      </IconButton>
                    </Tooltip>
                 </Box>

                                 {/* Правая группа кнопок */}
                 <Box sx={{ display: 'flex', gap: 1 }}>
                   {/* Кнопка отправки/остановки генерации */}
                   {state.messages.some(msg => msg.isStreaming) ? (
                     <Tooltip title="Прервать генерацию">
                       <IconButton
                         onClick={handleStopGeneration}
                         color="error"
                         sx={{
                           bgcolor: 'error.main',
                           color: 'white',
                           '&:hover': {
                             bgcolor: 'error.dark',
                           },
                           animation: 'pulse 2s ease-in-out infinite',
                           '@keyframes pulse': {
                             '0%': { opacity: 1 },
                             '50%': { opacity: 0.7 },
                             '100%': { opacity: 1 },
                           },
                         }}
                       >
                         <SquareIcon />
                       </IconButton>
                     </Tooltip>
                   ) : (
                     <Tooltip title="Отправить">
                       <IconButton
                         onClick={handleSendMessage}
                         disabled={!inputMessage.trim() || !isConnected || (state.isLoading && !state.messages.some(msg => msg.isStreaming))}
                         color="primary"
                         sx={{
                           bgcolor: 'primary.main',
                           color: 'white',
                           '&:hover': {
                             bgcolor: 'primary.dark',
                           },
                           '&:disabled': {
                             bgcolor: isDarkMode ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)',
                             color: isDarkMode ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.26)',
                               border: isDarkMode ? '1px solid rgba(255, 255, 255, 0.2)' : 'none',
                           }
                         }}
                       >
                         <SendIcon />
                       </IconButton>
                     </Tooltip>
                   )}

                  {/* Кнопка голосового ввода */}
                  <Tooltip title="Голосовой ввод">
                    <IconButton
                      onClick={() => setShowVoiceDialog(true)}
                      disabled={state.isLoading && !state.messages.some(msg => msg.isStreaming)}
                      sx={{
                        bgcolor: 'secondary.main',
                        color: 'white',
                        '&:hover': { 
                          bgcolor: 'secondary.dark' 
                        },
                        '&:disabled': {
                          bgcolor: isDarkMode ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)',
                          color: isDarkMode ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.26)',
                        }
                      }}
                    >
                      <MicIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
           </Box>
        </Box>

             {/* Диалоги */}
       <VoiceDialog />
       <DocumentDialog />

               {/* Выпадающее меню с дополнительными действиями (шестеренка) */}
       <Menu
         anchorEl={anchorEl}
         open={Boolean(anchorEl)}
         onClose={handleMenuClose}
         anchorOrigin={{
           vertical: 'top',
           horizontal: 'left',
         }}
         transformOrigin={{
           vertical: 'bottom',
           horizontal: 'left',
         }}
         PaperProps={{
           sx: {
             bgcolor: isDarkMode ? 'background.paper' : 'white',
             border: `1px solid ${isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}`,
             boxShadow: isDarkMode 
               ? '0 4px 20px rgba(0, 0, 0, 0.3)' 
               : '0 4px 20px rgba(0, 0, 0, 0.15)',
           }
         }}
       >
         <MenuItem onClick={handleClearChat} sx={{ gap: 1 }}>
           <ClearIcon fontSize="small" />
           Очистить чат
         </MenuItem>
         <MenuItem onClick={handleReconnect} sx={{ gap: 1 }}>
           <RefreshIcon fontSize="small" />
           Переподключиться
         </MenuItem>
       </Menu>

       {/* Уведомления */}
       <Snackbar
         open={showCopyAlert}
         autoHideDuration={2000}
         onClose={() => setShowCopyAlert(false)}
       >
         <Alert severity="success" onClose={() => setShowCopyAlert(false)}>
           Текст скопирован в буфер обмена
         </Alert>
       </Snackbar>
     </Box>
   );
 }

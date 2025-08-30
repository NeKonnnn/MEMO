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
  const { sendMessage, isConnected, reconnect } = useSocket();

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
          mb: 1,
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
        {isHovered && (
          <Box sx={{ 
            display: 'flex', 
            justifyContent: 'center',
            mt: 1,
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
                  '&:hover': { 
                    opacity: 1,
                  },
                }}
              >
                <CopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
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
              sx={{
                width: 80,
                height: 80,
                bgcolor: 'primary.main',
                color: 'white',
                '&:hover': { bgcolor: 'primary.dark' },
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
            transition: 'all 0.2s',
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
          transition: 'all 0.2s',
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

                 {/* Индикатор загрузки */}
         {state.isLoading && (
           <Box sx={{ 
             p: 2, 
             bgcolor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)' 
           }}>
             <LinearProgress sx={{ 
               '& .MuiLinearProgress-bar': { 
                 bgcolor: '#2196f3' 
               } 
             }} />
             <Typography variant="body2" sx={{ 
               mt: 1, 
               textAlign: 'center', 
               color: isDarkMode ? 'white' : '#333' 
             }}>
                               Газик ИИ думает...
             </Typography>
           </Box>
         )}

                 {/* Поле ввода */}
         <Box
           className="chat-input-area"
           data-theme={isDarkMode ? 'dark' : 'light'}
           sx={{
             borderColor: isDragging ? 'primary.main' : 'divider',
             bgcolor: isDragging ? 'action.hover' : 'transparent',
             transition: 'all 0.2s',
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

          {/* Поле ввода и кнопки */}
          <Box className="control-buttons">
            {/* Кнопки управления */}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Tooltip title="Очистить чат">
                <IconButton 
                  onClick={clearMessages} 
                  color="inherit" 
                  size="small"
                  className="control-button"
                >
                  <ClearIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="Переподключиться">
                <IconButton 
                  onClick={reconnect} 
                  color="inherit" 
                  size="small"
                  className="control-button"
                >
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
          
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 1,
              mt: 2,
            }}
          >
            {/* Кнопка загрузки документов */}
            <Tooltip title="Загрузить документ">
              <IconButton
                onClick={() => fileInputRef.current?.click()}
                sx={{ color: 'primary.main' }}
                disabled={isUploading}
              >
                {isUploading ? <CircularProgress size={20} /> : <AttachFileIcon />}
              </IconButton>
            </Tooltip>
            
            {/* Скрытый input для выбора файла */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.xlsx,.txt"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />

            {/* Поле ввода текста */}
            <TextField
              ref={inputRef}
              fullWidth
              multiline
              maxRows={4}
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Спросите что-нибудь..."
              variant="outlined"
              size="small"
              disabled={!isConnected || state.isLoading}
            />

            {/* Кнопка отправки */}
            <Tooltip title="Отправить">
              <IconButton
                onClick={handleSendMessage}
                disabled={!inputMessage.trim() || !isConnected || state.isLoading}
                color="primary"
              >
                <SendIcon />
              </IconButton>
            </Tooltip>

            {/* Кнопка голосового ввода */}
            <Tooltip title="Голосовой ввод">
              <IconButton
                onClick={() => setShowVoiceDialog(true)}
                sx={{
                  bgcolor: 'secondary.main',
                  color: 'white',
                  '&:hover': { bgcolor: 'secondary.dark' },
                }}
              >
                <MicIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

      {/* Диалоги */}
      <VoiceDialog />
      <DocumentDialog />

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

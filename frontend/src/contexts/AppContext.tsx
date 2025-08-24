import React, { createContext, useContext, useReducer, ReactNode } from 'react';

// Типы данных
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
}

export interface ModelInfo {
  loaded: boolean;
  metadata?: {
    'general.name': string;
    'general.architecture': string;
    'general.size_label': string;
  };
  path?: string;
  n_ctx?: number;
  n_gpu_layers?: number;
}

export interface ModelSettings {
  context_size: number;
  output_tokens: number;
  temperature: number;
  top_p: number;
  repeat_penalty: number;
  use_gpu: boolean;
  streaming: boolean;
  streaming_speed: number; // Скорость потоковой генерации в миллисекундах
}

export interface AppState {
  // Сообщения
  messages: Message[];
  isLoading: boolean;
  
  // Модель
  currentModel: ModelInfo | null;
  modelSettings: ModelSettings;
  availableModels: any[];
  
  // Голос
  isRecording: boolean;
  isSpeaking: boolean;
  voiceSettings: {
    voice_id: string;
    speech_rate: number;
  };
  
  // Транскрибация
  transcriptionSettings: {
    engine: 'whisperx' | 'vosk';
    language: string;
    auto_detect: boolean;
  };
  
  // Документы
  loadedDocument: string | null;
  
  // Системные уведомления
  notifications: Array<{
    id: string;
    type: 'success' | 'error' | 'info' | 'warning';
    message: string;
    timestamp: string;
  }>;
  
  // Статистика
  stats: {
    totalMessages: number;
    totalTokens: number;
    sessionsToday: number;
  };
}

// Действия
type AppAction =
  | { type: 'ADD_MESSAGE'; payload: Message }
  | { type: 'UPDATE_MESSAGE'; payload: { id: string; content?: string; isStreaming?: boolean } }
  | { type: 'APPEND_CHUNK'; payload: { id: string; chunk: string; isStreaming?: boolean } }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_CURRENT_MODEL'; payload: ModelInfo }
  | { type: 'SET_MODEL_SETTINGS'; payload: ModelSettings }
  | { type: 'SET_AVAILABLE_MODELS'; payload: any[] }
  | { type: 'SET_RECORDING'; payload: boolean }
  | { type: 'SET_SPEAKING'; payload: boolean }
  | { type: 'SET_VOICE_SETTINGS'; payload: { voice_id: string; speech_rate: number } }
  | { type: 'SET_TRANSCRIPTION_SETTINGS'; payload: { engine: 'whisperx' | 'vosk'; language: string; auto_detect: boolean } }
  | { type: 'SET_LOADED_DOCUMENT'; payload: string | null }
  | { type: 'ADD_NOTIFICATION'; payload: { type: string; message: string } }
  | { type: 'REMOVE_NOTIFICATION'; payload: string }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'UPDATE_STATS'; payload: Partial<AppState['stats']> };

// Функция для оценки количества токенов в тексте
function estimateTokens(text: string): number {
  if (!text) return 0;
  
  // Простая эвристика: 1 токен ≈ 4 символа для смешанного текста
  // Для русского текста может быть немного больше из-за длинных слов
  const baseTokens = Math.ceil(text.length / 4);
  
  // Дополнительные токены для специальных символов и форматирования
  const specialChars = (text.match(/[^\w\sа-яё]/g) || []).length;
  const newlines = (text.match(/\n/g) || []).length;
  
  return baseTokens + Math.ceil(specialChars / 2) + Math.ceil(newlines / 2);
}

// Функция для склеивания чанков (минимальные исправления)
function smartConcatenateChunk(existingContent: string, newChunk: string): string {
  if (!existingContent) return newChunk;
  if (!newChunk) return existingContent;
  
  // ТОЛЬКО критические исправления для кодовых блоков
  
  // 1. После ``` и языка программирования должен быть перенос строки
  const languageEndPattern = /```(python|javascript|typescript|java|cpp|c|php|ruby|go|rust|swift|kotlin|scala|html|css|sql|bash|shell|json|xml|yaml)$/;
  if (languageEndPattern.test(existingContent)) {
    return existingContent + '\n' + newChunk;
  }
  
  // 2. Начало кодового блока после текста
  if (newChunk.startsWith('```')) {
    const lastChar = existingContent[existingContent.length - 1];
    if (/[а-яёa-z]/i.test(lastChar)) {
      return existingContent + '\n\n' + newChunk;
    }
  }
  
  // ВСЕ ОСТАЛЬНОЕ - как было в оригинале (простое склеивание)
  return existingContent + newChunk;
}

// Начальное состояние
const initialState: AppState = {
  messages: [],
  isLoading: false,
  currentModel: null,
  modelSettings: {
    context_size: 2048,
    output_tokens: 512,
    temperature: 0.7,
    top_p: 0.95,
    repeat_penalty: 1.05,
    use_gpu: false,
    streaming: true,
    streaming_speed: 100, // Default streaming speed
  },
  availableModels: [],
  isRecording: false,
  isSpeaking: false,
  voiceSettings: {
    voice_id: 'ru',
    speech_rate: 1.0,
  },
  transcriptionSettings: {
    engine: 'whisperx',
    language: 'ru',
    auto_detect: true,
  },
  loadedDocument: null,
  notifications: [],
  stats: {
    totalMessages: 0,
    totalTokens: 0,
    sessionsToday: 0,
  },
};

// Reducer
function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'ADD_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, action.payload],
        stats: {
          ...state.stats,
          totalMessages: state.stats.totalMessages + 1,
          totalTokens: state.stats.totalTokens + estimateTokens(action.payload.content),
        },
      };
      
    case 'UPDATE_MESSAGE': {
      const updatedMessage = state.messages.find(msg => msg.id === action.payload.id);
      
      return {
        ...state,
        messages: state.messages.map(msg =>
          msg.id === action.payload.id
            ? { 
                ...msg, 
                ...(action.payload.content !== undefined && { content: action.payload.content }),
                ...(action.payload.isStreaming !== undefined && { isStreaming: action.payload.isStreaming })
              }
            : msg
        ),
        stats: {
          ...state.stats,
          // Обновляем токены при изменении содержимого сообщения
          totalTokens: state.stats.totalTokens - estimateTokens(updatedMessage?.content || '') + estimateTokens(action.payload.content || ''),
        },
      };
    }
      
    case 'APPEND_CHUNK': {
      const chunkMessage = state.messages.find(msg => msg.id === action.payload.id);
      const newContent = chunkMessage ? smartConcatenateChunk(chunkMessage.content, action.payload.chunk) : action.payload.chunk;
      
      return {
        ...state,
        messages: state.messages.map(msg =>
          msg.id === action.payload.id
            ? {
                ...msg,
                content: newContent,
                ...(action.payload.isStreaming !== undefined && { isStreaming: action.payload.isStreaming })
              }
            : msg
        ),
        stats: {
          ...state.stats,
          // Добавляем токены для нового чанка
          totalTokens: state.stats.totalTokens + estimateTokens(action.payload.chunk),
        },
      };
    }
      
    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.payload,
      };
      
    case 'SET_CURRENT_MODEL':
      return {
        ...state,
        currentModel: action.payload,
      };
      
    case 'SET_MODEL_SETTINGS':
      return {
        ...state,
        modelSettings: action.payload,
      };
      
    case 'SET_AVAILABLE_MODELS':
      return {
        ...state,
        availableModels: action.payload,
      };
      
    case 'SET_RECORDING':
      return {
        ...state,
        isRecording: action.payload,
      };
      
    case 'SET_SPEAKING':
      return {
        ...state,
        isSpeaking: action.payload,
      };
      
    case 'SET_VOICE_SETTINGS':
      return {
        ...state,
        voiceSettings: action.payload,
      };
      
    case 'SET_TRANSCRIPTION_SETTINGS':
      return {
        ...state,
        transcriptionSettings: action.payload,
      };
      
    case 'SET_LOADED_DOCUMENT':
      return {
        ...state,
        loadedDocument: action.payload,
      };
      
    case 'ADD_NOTIFICATION': {
      const notification = {
        id: Date.now().toString(),
        type: action.payload.type as 'success' | 'error' | 'info' | 'warning',
        message: action.payload.message,
        timestamp: new Date().toISOString(),
      };
      return {
        ...state,
        notifications: [...state.notifications, notification],
      };
    }
      
    case 'REMOVE_NOTIFICATION':
      return {
        ...state,
        notifications: state.notifications.filter(n => n.id !== action.payload),
      };
      
    case 'CLEAR_MESSAGES':
      return {
        ...state,
        messages: [],
        stats: {
          ...state.stats,
          totalMessages: 0,
          totalTokens: 0,
        },
      };
      
    case 'UPDATE_STATS':
      return {
        ...state,
        stats: {
          ...state.stats,
          ...action.payload,
        },
      };
      
    default:
      return state;
  }
}

// Контекст
const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
} | null>(null);

// Провайдер
export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  );
}

// Хук для использования контекста
export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}

// Хелперы для часто используемых действий
export function useAppActions() {
  const { dispatch } = useAppContext();

  return {
    addMessage: (message: Omit<Message, 'id'>) => {
      const messageId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
      dispatch({
        type: 'ADD_MESSAGE',
        payload: {
          ...message,
          id: messageId,
        },
      });
      return messageId;
    },
    
    updateMessage: (id: string, content?: string, isStreaming?: boolean) => {
      dispatch({ type: 'UPDATE_MESSAGE', payload: { id, content, isStreaming } });
    },
    
    appendChunk: (id: string, chunk: string, isStreaming?: boolean) => {
      dispatch({ type: 'APPEND_CHUNK', payload: { id, chunk, isStreaming } });
    },
    
    setLoading: (loading: boolean) => {
      dispatch({ type: 'SET_LOADING', payload: loading });
    },
    
    showNotification: (type: 'success' | 'error' | 'info' | 'warning', message: string) => {
      dispatch({ type: 'ADD_NOTIFICATION', payload: { type, message } });
    },
    
    removeNotification: (id: string) => {
      dispatch({ type: 'REMOVE_NOTIFICATION', payload: id });
    },
    
    clearMessages: () => {
      dispatch({ type: 'CLEAR_MESSAGES' });
    },
    
    setCurrentModel: (model: ModelInfo) => {
      dispatch({ type: 'SET_CURRENT_MODEL', payload: model });
    },
    
    setModelSettings: (settings: ModelSettings) => {
      dispatch({ type: 'SET_MODEL_SETTINGS', payload: settings });
    },
    
    setRecording: (recording: boolean) => {
      dispatch({ type: 'SET_RECORDING', payload: recording });
    },
    
    setSpeaking: (speaking: boolean) => {
      dispatch({ type: 'SET_SPEAKING', payload: speaking });
    },
    
    setTranscriptionSettings: (settings: { engine: 'whisperx' | 'vosk'; language: string; auto_detect: boolean }) => {
      dispatch({ type: 'SET_TRANSCRIPTION_SETTINGS', payload: settings });
    },
  };
}

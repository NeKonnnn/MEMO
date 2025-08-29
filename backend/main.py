"""
MemoAI Web Backend - FastAPI приложение
Современный веб-интерфейс для MemoAI с поддержкой всех функций
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import uvicorn
import asyncio
import json
import os
import sys
import traceback
from typing import List, Dict, Any, Optional
from datetime import datetime
import logging
from socketio import AsyncServer, ASGIApp
from starlette.applications import Starlette

# Добавляем корневую директорию в путь для импорта модулей
current_dir = os.path.dirname(os.path.abspath(__file__))
root_dir = os.path.dirname(current_dir)
sys.path.insert(0, root_dir)

# Настройка логирования в самом начале
logging.basicConfig(
    level=logging.DEBUG,
    format='[%(asctime)s] %(levelname)s [Backend] %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)
logger.info("Логирование настроено")

# Импорты из оригинального MemoAI
try:
    logger.info("Попытка импорта agent...")
    from backend.agent import ask_agent, model_settings, update_model_settings, reload_model_by_path, get_model_info, initialize_model
    logger.info("agent импортирован успешно")
    if ask_agent:
        logger.info("ask_agent функция доступна")
    else:
        logger.warning("ask_agent функция не доступна")

except ImportError as e:
    logger.error(f"Ошибка импорта agent: {e}")
    print(f"Ошибка импорта agent: {e}")
    print(f"Текущий путь: {os.getcwd()}")
    print(f"Python path: {sys.path}")
    ask_agent = None
    model_settings = None
    update_model_settings = None
    reload_model_by_path = None
    get_model_info = None
    initialize_model = None
except Exception as e:
    logger.error(f"Неожиданная ошибка при импорте agent: {e}")
    import traceback
    logger.error(f"Traceback: {traceback.format_exc()}")
    ask_agent = None
    model_settings = None
    update_model_settings = None
    reload_model_by_path = None
    get_model_info = None
    initialize_model = None
    
try:
    logger.info("Попытка импорта memory...")
    from backend.memory import save_dialog_entry, load_dialog_history, clear_dialog_history, get_recent_dialog_history
    logger.info("memory импортирован успешно")
    if save_dialog_entry:
        logger.info("save_dialog_entry функция доступна")
    else:
        logger.warning("save_dialog_entry функция не доступна")

except ImportError as e:
    logger.error(f"Ошибка импорта memory: {e}")
    print(f"Ошибка импорта memory: {e}")
    save_dialog_entry = None
    load_dialog_entry = None
    load_dialog_history = None
    clear_dialog_history = None
    get_recent_dialog_history = None
except Exception as e:
    logger.error(f"Неожиданная ошибка при импорте memory: {e}")
    import traceback
    logger.error(f"Traceback: {traceback.format_exc()}")
    save_dialog_entry = None
    load_dialog_entry = None
    load_dialog_history = None
    clear_dialog_history = None
    get_recent_dialog_history = None
    
try:
    logger.info("Попытка импорта voice...")
    from backend.voice import speak_text, recognize_speech, recognize_speech_from_file, check_vosk_model
    logger.info("voice импортирован успешно")

except ImportError as e:
    logger.error(f"Ошибка импорта voice: {e}")
    print(f"Ошибка импорта voice: {e}")
    speak_text = None
    recognize_speech = None
    recognize_speech_from_file = None
    check_vosk_model = None
except Exception as e:
    logger.error(f"Неожиданная ошибка при импорте voice: {e}")
    import traceback
    logger.error(f"Traceback: {traceback.format_exc()}")
    speak_text = None
    recognize_speech = None
    recognize_speech_from_file = None
    check_vosk_model = None

try:
    logger.info("Попытка импорта document_processor...")
    from backend.document_processor import DocumentProcessor
    logger.info("document_processor импортирован успешно")
except ImportError as e:
    logger.error(f"Ошибка импорта document_processor: {e}")
    print("Предупреждение: модуль document_processor не найден")
    DocumentProcessor = None
except Exception as e:
    logger.error(f"Неожиданная ошибка при импорте document_processor: {e}")
    import traceback
    logger.error(f"Traceback: {traceback.format_exc()}")
    DocumentProcessor = None
    
try:
    logger.info("Попытка импорта universal_transcriber...")
    from backend.universal_transcriber import UniversalTranscriber
    logger.info("universal_transcriber импортирован успешно")
except ImportError as e:
    logger.error(f"Ошибка импорта universal_transcriber: {e}")
    import traceback
    logger.error(f"Traceback: {traceback.format_exc()}")
    print("Предупреждение: модуль universal_transcriber не найден")
    UniversalTranscriber = None
except Exception as e:
    logger.error(f"Неожиданная ошибка при импорте universal_transcriber: {e}")
    import traceback
    logger.error(f"Traceback: {traceback.format_exc()}")
    UniversalTranscriber = None
    
try:
    logger.info("Попытка импорта online_transcription...")
    from backend.online_transcription import OnlineTranscriber
    logger.info("online_transcription импортирован успешно")
    if OnlineTranscriber:
        logger.info("OnlineTranscriber класс доступен")
    else:
        logger.warning("OnlineTranscriber класс не доступен")
except ImportError as e:
    logger.error(f"Ошибка импорта online_transcription: {e}")
    logger.error(f"Traceback: {traceback.format_exc()}")
    print("Предупреждение: модуль online_transcription не найден")
    OnlineTranscriber = None
except Exception as e:
    logger.error(f"Неожиданная ошибка при импорте online_transcription: {e}")
    logger.error(f"Traceback: {traceback.format_exc()}")
    OnlineTranscriber = None

# Создание Socket.IO сервера
sio = AsyncServer(
    async_mode='asgi',
    cors_allowed_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    ping_timeout=120,  # ping timeout до 2 минут
    ping_interval=25,  # Отправляем ping каждые 25 секунд
    logger=True,  # Включаем логирование для отладки
    engineio_logger=True  # Включаем логирование engine.io
)

# Создание FastAPI приложения
app = FastAPI(
    title="MemoAI Web API",
    description="Веб-интерфейс для персонального AI-ассистента MemoAI",
    version="1.0.0"
)

# Настройка CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", 
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:5173",  # Vite dev server
        "http://127.0.0.1:5173"
    ],  # React dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Создание Starlette приложения для Socket.IO
starlette_app = Starlette()
socket_app = ASGIApp(sio, starlette_app)

# Монтирование Socket.IO
app.mount("/socket.io", socket_app)

# Инициализация сервисов
logger.info("=== Инициализация сервисов ===")

try:
    logger.info("Импортируем DocumentProcessor...")
    doc_processor = DocumentProcessor() if DocumentProcessor else None
    if doc_processor:
        logger.info("DocumentProcessor инициализирован успешно")
        # Проверяем состояние
        doc_list = doc_processor.get_document_list()
        logger.info(f"Начальное состояние документов: {doc_list}")
        logger.info(f"Количество документов: {len(doc_list) if doc_list else 0}")
        
        # Проверяем атрибуты
        logger.info(f"Vectorstore доступен: {hasattr(doc_processor, 'vectorstore')}")
        logger.info(f"Documents доступен: {hasattr(doc_processor, 'documents')}")
        logger.info(f"Doc_names доступен: {hasattr(doc_processor, 'doc_names')}")
        logger.info(f"Embeddings доступен: {hasattr(doc_processor, 'embeddings')}")
        
        if hasattr(doc_processor, 'vectorstore'):
            logger.info(f"Vectorstore значение: {doc_processor.vectorstore is not None}")
            if doc_processor.vectorstore:
                logger.info("Vectorstore инициализирован успешно")
            else:
                logger.warning("Vectorstore не инициализирован")
        if hasattr(doc_processor, 'documents'):
            logger.info(f"Documents значение: {len(doc_processor.documents) if doc_processor.documents else 0}")
            if doc_processor.documents:
                logger.info("Documents коллекция содержит документы")
            else:
                logger.info("Documents коллекция пуста")
        if hasattr(doc_processor, 'doc_names'):
            logger.info(f"Doc_names значение: {len(doc_processor.doc_names) if doc_processor.doc_names else 0}")
            if doc_processor.doc_names:
                logger.info("Doc_names содержит имена документов")
            else:
                logger.info("Doc_names пуст")
        if hasattr(doc_processor, 'embeddings'):
            logger.info(f"Embeddings значение: {doc_processor.embeddings is not None}")
            if doc_processor.embeddings:
                logger.info("Embeddings модель загружена успешно")
            else:
                logger.warning("Embeddings модель не загружена")
    else:
        logger.warning("DocumentProcessor не доступен")
except Exception as e:
    logger.error(f"Ошибка инициализации DocumentProcessor: {e}")
    logger.error(f"Traceback: {traceback.format_exc()}")
    doc_processor = None

try:
    if UniversalTranscriber:
        logger.info("Инициализация UniversalTranscriber с движком whisperx...")
        transcriber = UniversalTranscriber(engine="whisperx")
        if transcriber:
            logger.info("UniversalTranscriber инициализирован успешно")
        else:
            logger.warning("UniversalTranscriber не удалось создать")
    else:
        logger.warning("UniversalTranscriber не доступен")
        transcriber = None
except Exception as e:
    logger.error(f"Ошибка инициализации UniversalTranscriber: {e}")
    logger.error(f"Traceback: {traceback.format_exc()}")
    transcriber = None

try:
    if OnlineTranscriber:
        logger.info("Инициализация OnlineTranscriber...")
        online_transcriber = OnlineTranscriber()
        if online_transcriber:
            logger.info("OnlineTranscriber инициализирован успешно")
        else:
            logger.warning("OnlineTranscriber не удалось создать")
    else:
        logger.warning("OnlineTranscriber класс не доступен")
        online_transcriber = None
except Exception as e:
    logger.error(f"Ошибка инициализации OnlineTranscriber: {e}")
    logger.error(f"Traceback: {traceback.format_exc()}")
    online_transcriber = None

logger.info("=== Инициализация сервисов завершена ===")

# Глобальные настройки транскрибации
current_transcription_engine = "whisperx"
current_transcription_language = "ru"

# Путь к файлу настроек
SETTINGS_FILE = os.path.join(os.path.dirname(__file__), "..", "settings.json")

def load_app_settings():
    """Загрузить настройки приложения из файла"""
    global current_transcription_engine, current_transcription_language
    
    try:
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                settings = json.load(f)
            
            current_transcription_engine = settings.get('transcription_engine', 'whisperx')
            current_transcription_language = settings.get('transcription_language', 'ru')
            
            logger.info(f"Настройки загружены: engine={current_transcription_engine}, language={current_transcription_language}")
            return settings
    except Exception as e:
        logger.error(f"Ошибка загрузки настроек: {e}")
    
    # Возвращаем дефолтные настройки
    return {
        'transcription_engine': current_transcription_engine,
        'transcription_language': current_transcription_language,
        'current_model_path': None
    }

def save_app_settings(settings_to_save):
    """Сохранить настройки приложения в файл"""
    try:
        # Загружаем существующие настройки
        existing_settings = {}
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, 'r', encoding='utf-8') as f:
                existing_settings = json.load(f)
        
        # Обновляем настройки
        existing_settings.update(settings_to_save)
        
        # Сохраняем в файл
        with open(SETTINGS_FILE, 'w', encoding='utf-8') as f:
            json.dump(existing_settings, f, ensure_ascii=False, indent=2)
        
        logger.info(f"Настройки сохранены: {settings_to_save}")
        return True
    except Exception as e:
        logger.error(f"Ошибка сохранения настроек: {e}")
        return False

# Загружаем настройки при старте
loaded_settings = load_app_settings()

# WebSocket менеджер для управления соединениями
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket connection established. Total connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
        logger.info(f"WebSocket connection closed. Total connections: {len(self.active_connections)}")

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except:
                pass

manager = ConnectionManager()

# Socket.IO события
@sio.event
async def connect(sid, environ):
    logger.info(f"Socket.IO client connected: {sid}")
    await sio.emit('connected', {'data': 'Connected to MemoAI'}, room=sid)

@sio.event
async def disconnect(sid):
    logger.info(f"Socket.IO client disconnected: {sid}")

@sio.event
async def ping(sid, data):
    """Обработка heartbeat ping от клиента"""
    try:
        # Отвечаем pong для подтверждения что сервер жив
        await sio.emit('pong', {
            'timestamp': data.get('timestamp', 0),
            'server_time': datetime.now().isoformat()
        }, room=sid)
    except Exception as e:
        logger.error(f"Ошибка обработки ping: {e}")

@sio.event
async def chat_message(sid, data):
    """Обработка сообщений чата через Socket.IO"""
    if not ask_agent or not save_dialog_entry:
        await sio.emit('chat_error', {
            'error': 'AI services not available'
        }, room=sid)
        return
        
    try:
        user_message = data.get("message", "")
        streaming = data.get("streaming", True)
        
        logger.info(f"Socket.IO chat: {user_message[:50]}...")
        
        # Получаем историю
        history = get_recent_dialog_history(max_entries=20) if get_recent_dialog_history else []
        
        # Сохраняем сообщение пользователя
        save_dialog_entry("user", user_message)
        
        # Функция для отправки частей ответа
        async def async_stream_callback(chunk: str, accumulated_text: str):
            try:
                logger.info(f"Отправляем chunk: '{chunk[:50]}...', накоплено: {len(accumulated_text)} символов")
                await sio.emit('chat_chunk', {
                    'chunk': chunk,
                    'accumulated': accumulated_text
                }, room=sid)
                logger.info(f"Chunk отправлен успешно")
            except Exception as e:
                logger.error(f"Ошибка отправки chunk: {e}")
                pass
        
        # Переменная для хранения event loop
        loop = asyncio.get_event_loop()
        
        # Синхронная обертка для потокового callback
        def sync_stream_callback(chunk: str, accumulated_text: str):
            try:
                # Планируем выполнение в основном event loop
                asyncio.run_coroutine_threadsafe(
                    async_stream_callback(chunk, accumulated_text), 
                    loop
                )
            except Exception as e:
                logger.error(f"Ошибка планирования задачи для chunk: {e}")
        
        try:
            # =============================================
            # ЛОГИКА ОБРАБОТКИ С ДОКУМЕНТАМИ (как в WebSocket)
            # =============================================
            final_message = user_message
            
            # Проверяем наличие документов и используем их контекст
            if doc_processor:
                logger.info("Socket.IO: doc_processor доступен")
                doc_list = doc_processor.get_document_list()
                logger.info(f"Socket.IO: список документов: {doc_list}")
                
                if doc_list and len(doc_list) > 0:
                    logger.info(f"Socket.IO: найдены документы: {doc_list}")
                    # Используем document processor для ответа с контекстом документов
                    logger.info("Socket.IO: используем document processor для ответа с контекстом документов")
                    
                    # Получаем контекст из документов
                    try:
                        doc_context = doc_processor.get_document_context(user_message)
                        logger.info(f"Socket.IO: получен контекст документов, длина: {len(doc_context) if doc_context else 0} символов")
                        
                        if doc_context:
                            # Формируем промпт с контекстом документов (упрощенный)
                            final_message = f"""Документы: {doc_context}

Вопрос: {user_message}

Ответь на основе документов."""
                            
                            logger.info("Socket.IO: отправляем промпт с контекстом в AI agent")
                        else:
                            logger.warning("Socket.IO: контекст документов пуст, используем исходное сообщение")
                            
                    except Exception as e:
                        logger.error(f"Socket.IO: ошибка при получении контекста документов: {e}")
                        # Fallback к обычному сообщению
                        logger.info("Socket.IO: используем fallback к исходному сообщению")
                else:
                    logger.info("Socket.IO: список документов пуст, используем исходное сообщение")
            else:
                logger.info("Socket.IO: doc_processor не доступен, используем исходное сообщение")
            
            # Генерация ответа
            if streaming:
                # Потоковая генерация в отдельном потоке
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    response = await asyncio.get_event_loop().run_in_executor(
                        executor,
                        ask_agent,
                        final_message,
                        history,
                        None,  # max_tokens
                        True,  # streaming
                        sync_stream_callback
                    )
                logger.info(f"Socket.IO: получен потоковый ответ, длина: {len(response)} символов")
            else:
                # Обычная генерация в отдельном потоке
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    response = await asyncio.get_event_loop().run_in_executor(
                        executor,
                        ask_agent,
                        final_message,
                        history,
                        None,  # max_tokens
                        False,  # streaming
                        None   # stream_callback
                    )
                logger.info(f"Socket.IO: получен ответ, длина: {len(response)} символов")
            
            # Сохраняем ответ
            save_dialog_entry("assistant", response)
            
            # Отправляем финальное сообщение
            await sio.emit('chat_complete', {
                'response': response,
                'timestamp': datetime.now().isoformat()
            }, room=sid)
            logger.info("Socket.IO: финальное сообщение отправлено")
            
        except Exception as e:
            logger.error(f"Ошибка генерации: {e}")
            await sio.emit('chat_error', {
                'error': str(e)
            }, room=sid)
            
    except Exception as e:
        logger.error(f"Socket.IO chat error: {e}")
        try:
            await sio.emit('chat_error', {
                'error': str(e)
            }, room=sid)
        except:
            logger.error("Не удалось отправить сообщение об ошибке клиенту")

# Модели данных
from pydantic import BaseModel

class ChatMessage(BaseModel):
    message: str
    streaming: bool = True

class ModelSettings(BaseModel):
    context_size: int = 2048
    output_tokens: int = 512
    temperature: float = 0.7
    top_p: float = 0.95
    repeat_penalty: float = 1.05
    use_gpu: bool = False
    streaming: bool = True

class VoiceSettings(BaseModel):
    voice_id: str = "ru"
    speech_rate: float = 1.0

class ModelLoadRequest(BaseModel):
    model_path: str

class ModelLoadResponse(BaseModel):
    message: str
    success: bool

# ================================
# ОСНОВНЫЕ API ENDPOINTS
# ================================

@app.get("/")
async def root():
    """Главная страница API"""
    return {"message": "MemoAI Web API", "status": "active", "version": "1.0.0"}

@app.get("/socket-test")
async def socket_test():
    """Тестовый endpoint для проверки Socket.IO"""
    return {
        "socketio_status": "active",
        "endpoint": "/socket.io/",
        "cors_origins": ["http://localhost:3000", "http://127.0.0.1:3000"],
        "ping_timeout": 120,
        "ping_interval": 25
    }

@app.get("/health")
async def health_check():
    """Проверка состояния системы"""
    try:
        model_info = get_model_info() if get_model_info else {"loaded": False}
        vosk_status = check_vosk_model() if check_vosk_model else False
        
        return {
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "services": {
                "llm_model": model_info.get("loaded", False),
                "vosk_model": vosk_status,
                "document_processor": DocumentProcessor is not None,
                "transcriber": UniversalTranscriber is not None
            }
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e),
            "timestamp": datetime.now().isoformat()
        }

# ================================
# ЧАТ API
# ================================

@app.post("/api/chat")
async def chat_with_ai(message: ChatMessage):
    """Отправить сообщение AI и получить ответ"""
    if not ask_agent:
        raise HTTPException(status_code=503, detail="AI agent не доступен")
    if not save_dialog_entry:
        raise HTTPException(status_code=503, detail="Memory module не доступен")
        
    try:
        logger.info(f"Chat request: {message.message[:50]}...")
        
        # Получаем историю диалога
        history = get_recent_dialog_history(max_entries=20) if get_recent_dialog_history else []
        
        # Проверяем, есть ли загруженные документы
        logger.info(f"doc_processor доступен: {doc_processor is not None}")
        if doc_processor:
            doc_list = doc_processor.get_document_list()
            logger.info(f"Список документов: {doc_list}")
            logger.info(f"Количество документов: {len(doc_list) if doc_list else 0}")
            
            if doc_list and len(doc_list) > 0:
                logger.info(f"Найдены документы: {doc_list}")
                # Используем document processor для ответа с контекстом документов
                logger.info("Используем document processor для ответа с контекстом документов")
                response = doc_processor.process_query(message.message, ask_agent)
                logger.info(f"Получен ответ от document processor, длина: {len(response)} символов")
            else:
                logger.info("Список документов пуст, используем обычный AI agent")
                # Отправляем запрос к модели без контекста документов
                response = ask_agent(
                    message.message,
                    history=history,
                    streaming=False  # Для REST API используем обычный режим
                )
                logger.info(f"Получен ответ от AI agent, длина: {len(response)} символов")
        else:
            logger.info("doc_processor не доступен, используем обычный AI agent")
            # Отправляем запрос к модели без контекста документов
            response = ask_agent(
                message.message,
                history=history,
                streaming=False  # Для REST API используем обычный режим
            )
            logger.info(f"Получен ответ от AI agent, длина: {len(response)} символов")
        
        # Сохраняем в память
        save_dialog_entry("user", message.message)
        save_dialog_entry("assistant", response)
        
        return {
            "response": response,
            "timestamp": datetime.now().isoformat(),
            "success": True
        }
        
    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    """WebSocket для потокового чата с AI"""
    if not ask_agent or not save_dialog_entry:
        await websocket.close(code=1008, reason="AI services not available")
        return
        
    await manager.connect(websocket)
    try:
        while True:
            # Получаем сообщение от клиента
            data = await websocket.receive_text()
            message_data = json.loads(data)
            
            user_message = message_data.get("message", "")
            streaming = message_data.get("streaming", True)
            
            logger.info(f"WebSocket chat: {user_message[:50]}...")
            
            # Получаем историю
            history = get_recent_dialog_history(max_entries=20) if get_recent_dialog_history else []
            
            # Сохраняем сообщение пользователя
            save_dialog_entry("user", user_message)
            
            # Функция для отправки частей ответа
            async def stream_callback(chunk: str, accumulated_text: str):
                try:
                    await websocket.send_text(json.dumps({
                        "type": "chunk",
                        "chunk": chunk,
                        "accumulated": accumulated_text
                    }))
                except:
                    pass
            
            try:
                # Проверяем, есть ли загруженные документы
                logger.info(f"WebSocket: doc_processor доступен: {doc_processor is not None}")
                if doc_processor:
                    doc_list = doc_processor.get_document_list()
                    logger.info(f"WebSocket: список документов: {doc_list}")
                    logger.info(f"WebSocket: количество документов: {len(doc_list) if doc_list else 0}")
                    logger.info(f"WebSocket: doc_list is None: {doc_list is None}")
                    logger.info(f"WebSocket: doc_list == []: {doc_list == []}")
                    logger.info(f"WebSocket: bool(doc_list): {bool(doc_list)}")
                    
                    if doc_list and len(doc_list) > 0:
                        logger.info(f"WebSocket: найдены документы: {doc_list}")
                        # Используем document processor для ответа с контекстом документов
                        logger.info("WebSocket: используем document processor для ответа с контекстом документов")
                        
                        # Получаем контекст из документов
                        try:
                            doc_context = doc_processor.get_document_context(user_message)
                            logger.info(f"WebSocket: получен контекст документов, длина: {len(doc_context) if doc_context else 0} символов")
                            
                            # Формируем промпт с контекстом документов
                            enhanced_prompt = f"""Контекст из загруженных документов:
{doc_context}

Вопрос пользователя: {user_message}

Пожалуйста, ответьте на вопрос пользователя, используя информацию из предоставленных документов. Если в документах нет информации для ответа, честно скажите об этом."""
                            
                            logger.info("WebSocket: отправляем промпт с контекстом в AI agent")
                            
                            if streaming:
                                response = ask_agent(
                                    enhanced_prompt,
                                    history=history,
                                    streaming=True,
                                    stream_callback=stream_callback
                                )
                            else:
                                response = ask_agent(
                                    enhanced_prompt,
                                    history=history,
                                    streaming=False
                                )
                            
                            logger.info(f"WebSocket: получен ответ от AI agent с контекстом документов, длина: {len(response)} символов")
                            
                        except Exception as e:
                            logger.error(f"WebSocket: ошибка при получении контекста документов: {e}")
                            # Fallback к обычному AI agent
                            if streaming:
                                response = ask_agent(
                                    user_message,
                                    history=history,
                                    streaming=True,
                                    stream_callback=stream_callback
                                )
                            else:
                                response = ask_agent(
                                    user_message,
                                    history=history,
                                    streaming=False
                                )
                            logger.info(f"WebSocket: использован fallback к обычному AI agent")
                    else:
                        logger.info("WebSocket: список документов пуст, используем обычный AI agent")
                        if streaming:
                            # Потоковая генерация
                            response = ask_agent(
                                user_message,
                                history=history,
                                streaming=True,
                                stream_callback=stream_callback
                            )
                            logger.info(f"WebSocket: получен потоковый ответ от AI agent, длина: {len(response)} символов")
                        else:
                            # Обычная генерация
                            response = ask_agent(
                                user_message,
                                history=history,
                                streaming=False
                            )
                            logger.info(f"WebSocket: получен ответ от AI agent, длина: {len(response)} символов")
                else:
                    logger.info("WebSocket: doc_processor не доступен, используем обычный AI agent")
                    if streaming:
                        # Потоковая генерация
                        response = ask_agent(
                            user_message,
                            history=history,
                            streaming=True,
                            stream_callback=stream_callback
                        )
                        logger.info(f"WebSocket: получен потоковый ответ от AI agent, длина: {len(response)} символов")
                    else:
                        # Обычная генерация
                        response = ask_agent(
                            user_message,
                            history=history,
                            streaming=False
                        )
                        logger.info(f"WebSocket: получен ответ от AI agent, длина: {len(response)} символов")
                
                # Сохраняем ответ
                save_dialog_entry("assistant", response)
                
                # Отправляем финальное сообщение
                await websocket.send_text(json.dumps({
                    "type": "complete",
                    "response": response,
                    "timestamp": datetime.now().isoformat()
                }))
                
            except Exception as e:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "error": str(e)
                }))
                
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)

async def process_audio_data(websocket: WebSocket, data: bytes):
    """Обработка аудио данных от WebSocket клиента"""
    import tempfile
    temp_dir = tempfile.gettempdir()
    audio_file = os.path.join(temp_dir, f"voice_{datetime.now().timestamp()}.wav")
    
    logger.info(f"Начинаю обработку аудио данных размером {len(data)} байт")
    
    try:
        # Сохраняем временный файл для обработки
        with open(audio_file, "wb") as f:
            f.write(data)
        
        # Проверяем, что получили действительно аудио данные
        if len(data) < 100:  # Слишком маленький размер для аудио
            logger.warning(f"Получены данные слишком маленького размера: {len(data)} байт")
            await websocket.send_text(json.dumps({
                "type": "error",
                "error": "Получены некорректные аудио данные"
            }))
            return
        
        # Распознаем речь
        logger.info(f"Обрабатываю аудио файл: {audio_file}")
        
        if not recognize_speech_from_file:
            logger.warning("recognize_speech_from_file функция не доступна")
            await websocket.send_text(json.dumps({
                "type": "speech_error",
                "error": "Модуль распознавания речи недоступен. Проверьте установку Vosk."
            }))
            return
            
        recognized_text = recognize_speech_from_file(audio_file)
        logger.info(f"РАСПОЗНАННЫЙ ТЕКСТ: '{recognized_text}'")
        
        if recognized_text and recognized_text.strip():
            # Отправляем распознанный текст клиенту
            await websocket.send_text(json.dumps({
                "type": "speech_recognized",
                "text": recognized_text,
                "timestamp": datetime.now().isoformat()
            }))
            
            # Получаем ответ от AI
            if not ask_agent:
                logger.warning("ask_agent функция не доступна")
                await websocket.send_text(json.dumps({
                    "type": "speech_error", 
                    "error": "AI модуль недоступен. Проверьте загрузку модели."
                }))
                return
                
            history = get_recent_dialog_history(max_entries=20) if get_recent_dialog_history else []
            logger.info(f"ОТПРАВЛЯЮ В LLM: текст='{recognized_text}', история={len(history)} записей")
            
            try:
                ai_response = ask_agent(recognized_text, history=history, streaming=False)
                logger.info(f"ОТВЕТ ОТ LLM: '{ai_response[:100]}{'...' if len(ai_response) > 100 else ''}')")
            except Exception as ai_error:
                logger.error(f"Ошибка обращения к AI: {ai_error}")
                await websocket.send_text(json.dumps({
                    "type": "speech_error",
                    "error": f"Ошибка AI модуля: {str(ai_error)}"
                }))
                return
            
            # Сохраняем в память
            save_dialog_entry("user", recognized_text)
            save_dialog_entry("assistant", ai_response)
            
            # Отправляем ответ AI клиенту
            await websocket.send_text(json.dumps({
                "type": "ai_response",
                "text": ai_response,
                "timestamp": datetime.now().isoformat()
            }))
            
            # Синтезируем речь
            speech_file = os.path.join(temp_dir, f"speech_{datetime.now().timestamp()}.wav")
            
            if not speak_text:
                logger.warning("speak_text функция не доступна")
                await websocket.send_text(json.dumps({
                    "type": "tts_error",
                    "error": "Модуль синтеза речи недоступен. Проверьте установку TTS библиотек."
                }))
                return
            
            if speak_text(ai_response, speaker='baya', voice_id='ru', save_to_file=speech_file):
                # Проверяем, что файл создался и не пустой
                if os.path.exists(speech_file) and os.path.getsize(speech_file) > 44:  # Минимальный размер WAV заголовка
                    with open(speech_file, "rb") as f:
                        audio_data = f.read()
                    await websocket.send_bytes(audio_data)
                    os.remove(speech_file)
                else:
                    # Файл не создался или поврежден
                    await websocket.send_text(json.dumps({
                        "type": "tts_error",
                        "error": "Не удалось создать аудиофайл"
                    }))
                    if os.path.exists(speech_file):
                        os.remove(speech_file)
            else:
                # Синтез не удался
                await websocket.send_text(json.dumps({
                    "type": "tts_error",
                    "error": "Ошибка синтеза речи"
                }))
        else:
            logger.warning("Речь не распознана или пустой текст")
            await websocket.send_text(json.dumps({
                "type": "speech_error",
                "error": "Речь не распознана, попробуйте еще раз"
            }))
            
    except Exception as e:
        logger.error(f"Ошибка обработки аудио данных: {e}")
        logger.error(f"Тип ошибки: {type(e).__name__}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "error": f"Ошибка обработки аудио: {str(e)}"
            }))
        except Exception as send_error:
            logger.error(f"Не удалось отправить сообщение об ошибке: {send_error}")
    finally:
        # Удаляем временный аудио файл
        if os.path.exists(audio_file):
            os.remove(audio_file)

@app.websocket("/ws/voice")
async def websocket_voice(websocket: WebSocket):
    """WebSocket для голосового чата в реальном времени"""
    
    # Принимаем соединение в любом случае
    await manager.connect(websocket)
    
    # Проверяем доступность сервисов после подключения
    if not ask_agent or not save_dialog_entry:
        logger.warning("AI services недоступны для WebSocket /ws/voice")
        await websocket.send_text(json.dumps({
            "type": "error",
            "error": "AI сервисы недоступны. Проверьте настройки модели."
        }))
        # Не закрываем соединение, просто отправляем ошибку
    try:
        while True:
            # Получаем сообщение (может быть JSON команда или аудио байты)
            try:
                # Пытаемся получить текстовое сообщение сначала
                message = await websocket.receive_text()
                logger.info(f"Получено текстовое сообщение: {message[:100]}...")  # Логируем первые 100 символов
                
                try:
                    data = json.loads(message)
                    logger.debug(f"Распарсенные данные: {data}")
                    
                    if data.get("type") == "start_listening":
                        # Команда начать прослушивание
                        logger.info("Получена команда start_listening")
                        await websocket.send_text(json.dumps({
                            "type": "listening_started",
                            "message": "Готов к приему голоса"
                        }))
                        continue
                    else:
                        logger.warning(f"Неизвестный тип сообщения: {data.get('type', 'unknown')}")
                        logger.debug(f"Полные данные неизвестного сообщения: {data}")
                        continue
                        
                except json.JSONDecodeError as e:
                    logger.error(f"Ошибка парсинга JSON: {e}")
                    logger.error(f"Проблемное сообщение: {message}")
                    continue
                    
            except UnicodeDecodeError:
                # Если не можем декодировать как текст, пробуем получить как байты
                try:
                    data = await websocket.receive_bytes()
                    logger.info(f"Получены аудио данные размером: {len(data)} байт")
                    
                    # Обрабатываем аудио данные
                    await process_audio_data(websocket, data)
                    
                except Exception as e:
                    logger.error(f"Ошибка получения аудио данных: {e}")
                    logger.error(f"Тип ошибки: {type(e).__name__}")
                    continue
                
                # Убираем дублирующийся код - теперь обрабатываем через process_audio_data
                continue
                    
    except WebSocketDisconnect:
        logger.info("WebSocket отключен клиентом")
        manager.disconnect(websocket)
    except Exception as e:
        logger.error(f"Voice WebSocket error: {e}")
        logger.error(f"Тип ошибки: {type(e).__name__}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "error": str(e)
            }))
        except Exception as send_error:
            logger.error(f"Не удалось отправить сообщение об ошибке: {send_error}")
        finally:
            manager.disconnect(websocket)

# ================================
# ИСТОРИЯ ДИАЛОГОВ
# ================================

@app.get("/api/history")
async def get_chat_history(limit: int = 50):
    """Получить историю диалогов"""
    if not get_recent_dialog_history:
        # Попытка прямого чтения файла если модуль memory недоступен
        try:
            import json
            import os
            from backend.config.config import MEMORY_PATH
            
            dialog_file = os.path.join(MEMORY_PATH, "dialog_history_dialog.json")
            
            if os.path.exists(dialog_file):
                with open(dialog_file, "r", encoding="utf-8") as f:
                    history = json.load(f)
                    # Ограничиваем количество записей
                    limited_history = history[-limit:] if len(history) > limit else history
                    logger.info(f"Загружено {len(limited_history)} записей истории из файла (модуль memory недоступен)")
                    return {
                        "history": limited_history,
                        "count": len(limited_history),
                        "timestamp": datetime.now().isoformat(),
                        "source": "file_fallback"
                    }
            else:
                logger.warning(f"Файл истории не найден: {dialog_file}")
                return {
                    "history": [],
                    "count": 0,
                    "timestamp": datetime.now().isoformat(),
                    "source": "file_fallback",
                    "message": "Файл истории не найден"
                }
        except Exception as e:
            logger.error(f"Ошибка чтения истории из файла: {e}")
            return {
                "history": [],
                "count": 0,
                "timestamp": datetime.now().isoformat(),
                "source": "fallback_error",
                "error": str(e)
            }
    
    try:
        history = get_recent_dialog_history(max_entries=limit)
        logger.info(f"Загружено {len(history)} записей истории через модуль memory")
        return {
            "history": history,
            "count": len(history),
            "timestamp": datetime.now().isoformat(),
            "source": "memory_module"
        }
    except Exception as e:
        logger.error(f"Ошибка получения истории через модуль memory: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/history")
async def clear_chat_history():
    """Очистить историю диалогов"""
    if not clear_dialog_history:
        # Попытка прямого удаления файлов если модуль memory недоступен
        try:
            import os
            from backend.config.config import MEMORY_PATH
            
            dialog_file = os.path.join(MEMORY_PATH, "dialog_history_dialog.json")
            memory_file = os.path.join(MEMORY_PATH, "dialog_history.txt")
            
            files_removed = []
            if os.path.exists(dialog_file):
                os.remove(dialog_file)
                files_removed.append("dialog_history_dialog.json")
            if os.path.exists(memory_file):
                os.remove(memory_file)
                files_removed.append("dialog_history.txt")
            
            logger.info(f"Удалены файлы истории: {files_removed} (модуль memory недоступен)")
            return {
                "message": f"История очищена (удалено файлов: {len(files_removed)})",
                "success": True,
                "files_removed": files_removed,
                "source": "file_fallback"
            }
        except Exception as e:
            logger.error(f"Ошибка удаления файлов истории: {e}")
            raise HTTPException(status_code=500, detail=f"Ошибка очистки истории: {str(e)}")
    
    try:
        result = clear_dialog_history()
        logger.info(f"История очищена через модуль memory: {result}")
        return {
            "message": "История очищена", 
            "success": True,
            "source": "memory_module"
        }
    except Exception as e:
        logger.error(f"Ошибка очистки истории через модуль memory: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ================================
# УПРАВЛЕНИЕ МОДЕЛЯМИ
# ================================

@app.get("/api/models/current")
async def get_current_model():
    """Получить информацию о текущей модели"""
    # Пытаемся получить информацию от модуля AI
    if get_model_info:
        try:
            result = get_model_info()
            logger.info(f"Информация о текущей модели от AI модуля: {result}")
            
            # Сохраняем информацию о текущей модели
            if result and 'path' in result:
                save_app_settings({
                    'current_model_path': result['path'],
                    'current_model_name': result.get('name', 'Unknown'),
                    'current_model_status': result.get('status', 'loaded')
                })
            
            return result
        except Exception as e:
            logger.error(f"Ошибка получения информации о модели от AI модуля: {e}")
    
    # Если AI модуль недоступен, проверяем сохраненные настройки
    try:
        settings = load_app_settings()
        current_model_path = settings.get('current_model_path')
        
        if current_model_path and os.path.exists(current_model_path):
            file_size = os.path.getsize(current_model_path)
            return {
                "name": settings.get('current_model_name', os.path.basename(current_model_path)),
                "path": current_model_path,
                "status": "loaded_from_settings",
                "size": file_size,
                "size_mb": round(file_size / (1024 * 1024), 2),
                "type": "gguf"
            }
    except Exception as e:
        logger.error(f"Ошибка проверки сохраненных настроек модели: {e}")
    
    # Если ничего не найдено, возвращаем заглушку
    logger.warning("get_model_info функция не доступна и нет сохраненной модели")
    return {
        "name": "Модель не загружена",
        "path": "",
        "status": "not_loaded",
        "size": 0,
        "type": "unknown"
    }

@app.get("/api/models")
async def get_models():
    """Получить список доступных моделей (алиас для /api/models/available)"""
    return await get_available_models()

@app.get("/api/models/available")
async def get_available_models():
    """Получить список доступных моделей"""
    try:
        models_dir = "models"
        if not os.path.exists(models_dir):
            return {"models": []}
        
        models = []
        for file in os.listdir(models_dir):
            if file.endswith('.gguf'):
                file_path = os.path.join(models_dir, file)
                size = os.path.getsize(file_path)
                models.append({
                    "name": file,
                    "path": file_path,
                    "size": size,
                    "size_mb": round(size / (1024 * 1024), 2)
                })
        
        return {"models": models}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/models/load")
async def load_model(request: ModelLoadRequest):
    """Загрузить модель по указанному пути"""
    if not reload_model_by_path:
        logger.warning("reload_model_by_path функция не доступна")
        return ModelLoadResponse(
            message="Функция загрузки модели недоступна. Проверьте инициализацию AI agent.", 
            success=False
        )
    
    try:
        logger.info(f"Загружаю модель: {request.model_path}")
        success = reload_model_by_path(request.model_path)
        if success:
            logger.info(f"Модель успешно загружена: {request.model_path}")
            
            # Сохраняем информацию о загруженной модели
            model_name = os.path.basename(request.model_path)
            save_app_settings({
                'current_model_path': request.model_path,
                'current_model_name': model_name,
                'current_model_status': 'loaded'
            })
            
            return ModelLoadResponse(message="Модель успешно загружена", success=True)
        else:
            logger.error(f"Не удалось загрузить модель: {request.model_path}")
            return ModelLoadResponse(message="Не удалось загрузить модель", success=False)
    except Exception as e:
        logger.error(f"Ошибка загрузки модели: {e}")
        return ModelLoadResponse(message=f"Ошибка загрузки модели: {str(e)}", success=False)

@app.get("/api/models/settings")
async def get_model_settings():
    """Получить настройки модели"""
    if not model_settings:
        logger.warning("model_settings не доступен, возвращаю дефолтные настройки")
        # Возвращаем дефолтные настройки вместо 503 ошибки
        return {
            "context_size": 2048,
            "output_tokens": 512,
            "temperature": 0.7,
            "top_p": 0.95,
            "repeat_penalty": 1.05,
            "use_gpu": False,
            "streaming": True,
            "streaming_speed": 50
        }
    try:
        result = model_settings.get_all()
        logger.info(f"Настройки модели: {result}")
        return result
    except Exception as e:
        logger.error(f"Ошибка получения настроек модели: {e}")
        # Возвращаем дефолтные настройки в случае ошибки
        return {
            "context_size": 2048,
            "output_tokens": 512,
            "temperature": 0.7,
            "top_p": 0.95,
            "repeat_penalty": 1.05,
            "use_gpu": False,
            "streaming": True,
            "streaming_speed": 50
        }

@app.put("/api/models/settings")
async def update_model_settings_api(settings: ModelSettings):
    """Обновить настройки модели"""
    if not update_model_settings:
        raise HTTPException(status_code=503, detail="AI agent не доступен")
    try:
        success = update_model_settings(settings.dict())
        if success:
            return {"message": "Настройки обновлены", "success": True}
        else:
            raise HTTPException(status_code=400, detail="Не удалось обновить настройки")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ================================
# ГОЛОСОВЫЕ ФУНКЦИИ
# ================================

class VoiceSynthesizeRequest(BaseModel):
    text: str
    voice_id: str = "ru"
    voice_speaker: str = "baya"

class TranscriptionSettings(BaseModel):
    engine: str = "whisperx"  # whisperx или vosk
    language: str = "ru"
    auto_detect: bool = True

class YouTubeTranscribeRequest(BaseModel):
    url: str

class DocumentQueryRequest(BaseModel):
    query: str

@app.post("/api/voice/synthesize")
async def synthesize_speech(request: VoiceSynthesizeRequest):
    """Синтезировать речь из текста"""
    if not speak_text:
        logger.warning("speak_text функция не доступна")
        raise HTTPException(status_code=503, detail="Модуль синтеза речи недоступен. Проверьте установку библиотек для TTS (pyttsx3, sounddevice, torch).")
    
    import tempfile
    temp_dir = tempfile.gettempdir()
    audio_file = os.path.join(temp_dir, f"speech_{datetime.now().timestamp()}.wav")
    
    try:
        # Логируем отладочную информацию
        logger.info(f"Синтезирую речь: '{request.text[:100]}{'...' if len(request.text) > 100 else ''}'")
        logger.info(f"Параметры: voice_id={request.voice_id}, voice_speaker={request.voice_speaker}")
        
        # Синтезируем речь с правильными параметрами
        success = speak_text(
            text=request.text, 
            speaker=request.voice_speaker, 
            voice_id=request.voice_id, 
            save_to_file=audio_file
        )
        
        if success and os.path.exists(audio_file):
            logger.info(f"Аудиофайл создан: {audio_file}, размер: {os.path.getsize(audio_file)} байт")
            
            # Создаем временную копию для возврата, оригинал удалится автоматически
            temp_copy = os.path.join(temp_dir, f"speech_copy_{datetime.now().timestamp()}.wav")
            import shutil
            shutil.copy2(audio_file, temp_copy)
            
            # Удаляем оригинальный файл
            os.remove(audio_file)
            
            # Возвращаем копию, которая удалится после отправки
            return FileResponse(
                temp_copy,
                media_type="audio/wav",
                filename="speech.wav",
                background=lambda: os.remove(temp_copy) if os.path.exists(temp_copy) else None
            )
        else:
            logger.error(f"Не удалось создать аудиофайл: success={success}, exists={os.path.exists(audio_file)}")
            raise HTTPException(status_code=500, detail="Не удалось создать аудиофайл")
            
    except Exception as e:
        logger.error(f"Ошибка синтеза речи: {e}")
        # Очищаем временный файл в случае ошибки
        if os.path.exists(audio_file):
            os.remove(audio_file)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/voice/recognize")
async def recognize_speech_api(audio_file: UploadFile = File(...)):
    """Распознать речь из аудиофайла"""
    if not recognize_speech_from_file:
        logger.warning("recognize_speech_from_file функция не доступна")
        return {
            "text": "",
            "success": False,
            "error": "Модуль распознавания речи недоступен. Проверьте настройки Vosk.",
            "timestamp": datetime.now().isoformat()
        }
    
    import tempfile
    temp_dir = tempfile.gettempdir()
    file_path = os.path.join(temp_dir, f"audio_{datetime.now().timestamp()}.wav")
    
    try:
        # Сохраняем загруженный файл
        content = await audio_file.read()
        logger.info(f"Получен аудиофайл: {audio_file.filename}, размер: {len(content)} байт")
        
        with open(file_path, "wb") as f:
            f.write(content)
        
        logger.info(f"Аудиофайл сохранен: {file_path}")
        
        # Распознаем речь используя правильную функцию
        text = recognize_speech_from_file(file_path)
        
        # Логируем результат распознавания
        logger.info(f"Распознанный текст: '{text}'")
        
        return {
            "text": text,
            "success": True,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Ошибка распознавания речи: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # Всегда удаляем временный файл
        if os.path.exists(file_path):
            os.remove(file_path)
            logger.info(f"Временный файл удален: {file_path}")

@app.get("/api/voice/settings")
async def get_voice_settings():
    """Получить настройки голоса"""
    # Возвращаем дефолтные настройки, можно расширить для сохранения в файл
    return {
        "voice_id": "ru",
        "speech_rate": 1.0,
        "voice_speaker": "baya"
    }

@app.put("/api/voice/settings")
async def update_voice_settings(settings: VoiceSettings):
    """Обновить настройки голоса"""
    # В реальной реализации можно сохранять настройки в файл
    return {
        "message": "Настройки голоса обновлены",
        "success": True,
        "settings": settings.dict()
    }

@app.get("/api/transcription/settings")
async def get_transcription_settings():
    """Получить настройки транскрибации"""
    global current_transcription_engine, current_transcription_language
    return {
        "engine": current_transcription_engine,
        "language": current_transcription_language,
        "auto_detect": True
    }

@app.put("/api/transcription/settings")
async def update_transcription_settings(settings: TranscriptionSettings):
    """Обновить настройки транскрибации"""
    global current_transcription_engine, current_transcription_language, transcriber
    
    try:
        # Обновляем глобальные настройки
        if settings.engine:
            current_transcription_engine = settings.engine.lower()
            logger.info(f"Переключение движка транскрибации на: {current_transcription_engine}")
            
            # Переключаем движок в UniversalTranscriber
            if transcriber and hasattr(transcriber, 'switch_engine'):
                success = transcriber.switch_engine(current_transcription_engine)
                if success:
                    logger.info(f"Движок успешно переключен на {current_transcription_engine}")
                else:
                    logger.error(f"Ошибка переключения движка на {current_transcription_engine}")
                    # Возвращаем ошибку если переключение не удалось
                    raise HTTPException(status_code=400, detail=f"Не удалось переключить движок на {current_transcription_engine}")
            else:
                logger.warning("Transcriber не поддерживает переключение движков")
        
        if settings.language:
            current_transcription_language = settings.language
            logger.info(f"Язык транскрибации изменен на: {current_transcription_language}")
            
            # Устанавливаем язык в текущем транскрайбере
            if transcriber and hasattr(transcriber, 'set_language'):
                transcriber.set_language(current_transcription_language)
        
        # Сохраняем настройки транскрибации в файл
        save_app_settings({
            'transcription_engine': current_transcription_engine,
            'transcription_language': current_transcription_language
        })
        
        return {
            "message": "Настройки транскрибации обновлены",
            "success": True,
            "settings": {
                "engine": current_transcription_engine,
                "language": current_transcription_language,
                "auto_detect": settings.auto_detect if hasattr(settings, 'auto_detect') else True
            }
        }
        
    except Exception as e:
        logger.error(f"Ошибка обновления настроек транскрибации: {e}")
        raise HTTPException(status_code=500, detail=f"Ошибка обновления настроек: {str(e)}")

# ================================
# РАБОТА С ДОКУМЕНТАМИ
# ================================

@app.post("/api/documents/upload")
async def upload_document(file: UploadFile = File(...)):
    """Загрузить и обработать документ"""
    logger.info(f"=== Загрузка документа: {file.filename} ===")
    
    if not doc_processor:
        logger.error("Document processor не доступен")
        raise HTTPException(status_code=503, detail="Document processor не доступен")
        
    try:
        # Сохраняем файл
        import tempfile
        temp_dir = tempfile.gettempdir()
        file_path = os.path.join(temp_dir, f"doc_{datetime.now().timestamp()}_{file.filename}")
        logger.info(f"Временный путь файла: {file_path}")
        
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)
        
        logger.info(f"Файл сохранен, размер: {len(content)} байт")
        
        # Обрабатываем документ
        logger.info("Начинаем обработку документа...")
        logger.info(f"Файл существует: {os.path.exists(file_path)}")
        logger.info(f"Размер файла: {os.path.getsize(file_path) if os.path.exists(file_path) else 'N/A'} байт")
        
        success, message = doc_processor.process_document(file_path)
        logger.info(f"Результат обработки: success={success}, message={message}")
        
        if success:
            # Получаем список документов после обработки
            doc_list = doc_processor.get_document_list()
            logger.info(f"Список документов после обработки: {doc_list}")
            logger.info(f"Количество документов: {len(doc_list) if doc_list else 0}")
            
            # Проверяем состояние vectorstore
            if hasattr(doc_processor, 'vectorstore'):
                logger.info(f"Vectorstore доступен: {doc_processor.vectorstore is not None}")
                if hasattr(doc_processor, 'documents'):
                    logger.info(f"Количество документов в коллекции: {len(doc_processor.documents) if doc_processor.documents else 0}")
            
            # Очищаем временный файл
            try:
                os.remove(file_path)
                logger.info(f"Временный файл удален: {file_path}")
            except Exception as e:
                logger.warning(f"Не удалось удалить временный файл: {e}")
            
            return {
                "message": "Документ успешно загружен и обработан",
                "filename": file.filename,
                "success": True
            }
        else:
            # Очищаем временный файл в случае ошибки
            try:
                os.remove(file_path)
                logger.info(f"Временный файл удален после ошибки: {file_path}")
            except Exception as e:
                logger.warning(f"Не удалось удалить временный файл после ошибки: {e}")
            
            raise HTTPException(status_code=400, detail=message)
            
    except Exception as e:
        logger.error(f"Ошибка при загрузке документа: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/documents/query")
async def query_document(request: DocumentQueryRequest):
    """Задать вопрос по загруженному документу"""
    logger.info(f"=== Запрос к документам: {request.query[:50]}... ===")
    
    if not doc_processor:
        logger.error("Document processor не доступен")
        raise HTTPException(status_code=503, detail="Document processor не доступен")
        
    try:
        if not ask_agent:
            logger.error("AI agent не доступен")
            raise HTTPException(status_code=503, detail="AI agent не доступен")
        
        # Получаем список документов
        doc_list = doc_processor.get_document_list()
        logger.info(f"Доступные документы: {doc_list}")
        logger.info(f"Количество документов: {len(doc_list) if doc_list else 0}")
        
        # Проверяем состояние vectorstore
        if hasattr(doc_processor, 'vectorstore'):
            logger.info(f"Vectorstore доступен: {doc_processor.vectorstore is not None}")
            if hasattr(doc_processor, 'documents'):
                logger.info(f"Количество документов в коллекции: {len(doc_processor.documents) if doc_processor.documents else 0}")
        
        response = doc_processor.process_query(request.query, ask_agent)
        logger.info(f"Получен ответ от document processor, длина: {len(response)} символов")
        
        return {
            "response": response,
            "query": request.query,
            "success": True,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Ошибка при запросе к документам: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/documents")
async def get_documents():
    """Получить список загруженных документов"""
    logger.info("=== Получение списка документов ===")
    
    if not doc_processor:
        logger.error("Document processor не доступен")
        raise HTTPException(status_code=503, detail="Document processor не доступен")
        
    try:
        doc_list = doc_processor.get_document_list()
        logger.info(f"Список документов: {doc_list}")
        
        return {
            "documents": doc_list,
            "count": len(doc_list) if doc_list else 0,
            "success": True
        }
    except Exception as e:
        logger.error(f"Ошибка при получении списка документов: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/documents/{filename}")
async def delete_document(filename: str):
    """Удалить документ по имени файла"""
    logger.info(f"=== Удаление документа: {filename} ===")
    
    if not doc_processor:
        logger.error("Document processor не доступен")
        raise HTTPException(status_code=503, detail="Document processor не доступен")
        
    try:
        # Получаем список документов
        doc_list = doc_processor.get_document_list()
        logger.info(f"Доступные документы до удаления: {doc_list}")
        
        if not doc_list or filename not in doc_list:
            logger.warning(f"Документ {filename} не найден")
            raise HTTPException(status_code=404, detail=f"Документ {filename} не найден")
        
        # Удаляем документ
        success = doc_processor.remove_document(filename)
        logger.info(f"Результат удаления: {success}")
        
        if success:
            # Получаем обновленный список документов
            new_doc_list = doc_processor.get_document_list()
            logger.info(f"Документы после удаления: {new_doc_list}")
            
            return {
                "message": f"Документ {filename} успешно удален",
                "success": True,
                "remaining_documents": new_doc_list
            }
        else:
            raise HTTPException(status_code=500, detail="Не удалось удалить документ")
            
    except Exception as e:
        logger.error(f"Ошибка при удалении документа: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ================================
# ТРАНСКРИБАЦИЯ
# ================================

@app.post("/api/transcribe/upload")
async def transcribe_file(file: UploadFile = File(...)):
    """Транскрибировать аудио/видео файл с диаризацией по ролям"""
    logger.info(f"=== Начало транскрибации файла с диаризацией: {file.filename} ===")
    
    if not transcriber:
        logger.error("Transcriber не доступен")
        raise HTTPException(status_code=503, detail="Transcriber не доступен")
        
    try:
        # Сохраняем файл
        import tempfile
        temp_dir = tempfile.gettempdir()
        file_path = os.path.join(temp_dir, f"media_{datetime.now().timestamp()}_{file.filename}")
        logger.info(f"Временный путь файла: {file_path}")
        
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)
        
        logger.info(f"Файл сохранен, размер: {len(content)} байт")
        
        # Транскрибируем с принудительной диаризацией
        logger.info(f"Начинаем транскрибацию с диаризацией по ролям...")
        
        # Проверяем, поддерживает ли транскрайбер диаризацию
        if hasattr(transcriber, 'transcribe_with_diarization'):
            logger.info("Используем принудительную диаризацию...")
            success, result = transcriber.transcribe_with_diarization(file_path)
        else:
            logger.info("Используем стандартную транскрибацию...")
            success, result = transcriber.transcribe_audio_file(file_path)
        
        logger.info(f"Результат транскрибации: success={success}, result_length={len(str(result)) if result else 0}")
        
        if success:
            logger.info("Транскрибация с диаризацией завершена успешно")
            return {
                "transcription": result,
                "filename": file.filename,
                "success": True,
                "timestamp": datetime.now().isoformat(),
                "diarization": True
            }
        else:
            logger.error(f"Ошибка транскрибации: {result}")
            raise HTTPException(status_code=400, detail=result)
            
    except Exception as e:
        logger.error(f"Ошибка в эндпоинте транскрибации: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/transcribe/upload/diarization")
async def transcribe_file_with_diarization(file: UploadFile = File(...)):
    """Принудительно транскрибировать аудио/видео файл с диаризацией по ролям"""
    logger.info(f"=== Начало принудительной диаризации файла: {file.filename} ===")
    
    if not transcriber:
        logger.error("Transcriber не доступен")
        raise HTTPException(status_code=503, detail="Transcriber не доступен")
        
    try:
        # Сохраняем файл
        import tempfile
        temp_dir = tempfile.gettempdir()
        file_path = os.path.join(temp_dir, f"media_diarization_{datetime.now().timestamp()}_{file.filename}")
        logger.info(f"Временный путь файла для диаризации: {file_path}")
        
        with open(file_path, "wb") as f:
            content = await file.read()
            f.write(content)
        
        logger.info(f"Файл сохранен, размер: {len(content)} байт")
        
        # Принудительная диаризация с WhisperX
        logger.info("Начинаем принудительную диаризацию по ролям...")
        
        if hasattr(transcriber, 'transcribe_with_diarization'):
            success, result = transcriber.transcribe_with_diarization(file_path)
        else:
            logger.warning("Транскрайбер не поддерживает диаризацию, используем стандартную транскрибацию")
            success, result = transcriber.transcribe_audio_file(file_path)
        
        logger.info(f"Результат диаризации: success={success}, result_length={len(str(result)) if result else 0}")
        
        if success:
            logger.info("Диаризация завершена успешно")
            return {
                "transcription": result,
                "filename": file.filename,
                "success": True,
                "timestamp": datetime.now().isoformat(),
                "diarization": True,
                "forced_diarization": True
            }
        else:
            logger.error(f"Ошибка диаризации: {result}")
            raise HTTPException(status_code=400, detail=result)
            
    except Exception as e:
        logger.error(f"Ошибка в эндпоинте диаризации: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/transcribe/youtube")
async def transcribe_youtube(request: YouTubeTranscribeRequest):
    """Транскрибировать видео с YouTube с диаризацией по ролям"""
    logger.info(f"=== Начало YouTube транскрибации с диаризацией: {request.url} ===")
    
    if not transcriber:
        logger.error("Transcriber не доступен")
        raise HTTPException(status_code=503, detail="Transcriber не доступен")
        
    try:
        logger.info("Начинаем YouTube транскрибацию с диаризацией...")
        success, result = transcriber.transcribe_youtube(request.url)
        logger.info(f"Результат YouTube транскрибации: success={success}, result_length={len(str(result)) if result else 0}")
        
        if success:
            logger.info("YouTube транскрибация с диаризацией завершена успешно")
            return {
                "transcription": result,
                "url": request.url,
                "success": True,
                "timestamp": datetime.now().isoformat(),
                "diarization": True
            }
        else:
            logger.error(f"Ошибка YouTube транскрибации: {result}")
            raise HTTPException(status_code=400, detail=result)
            
    except Exception as e:
        logger.error(f"Ошибка в эндпоинте YouTube транскрибации: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/system/status")
async def get_system_status():
    """Получить статус всех модулей системы"""
    return {
        "modules": {
            "ai_agent": {
                "available": ask_agent is not None,
                "functions": {
                    "ask_agent": ask_agent is not None,
                    "model_settings": model_settings is not None,
                    "update_model_settings": update_model_settings is not None,
                    "reload_model_by_path": reload_model_by_path is not None,
                    "get_model_info": get_model_info is not None,
                    "initialize_model": initialize_model is not None
                }
            },
            "memory": {
                "available": save_dialog_entry is not None,
                "functions": {
                    "save_dialog_entry": save_dialog_entry is not None,
                    "load_dialog_history": load_dialog_history is not None,
                    "clear_dialog_history": clear_dialog_history is not None,
                    "get_recent_dialog_history": get_recent_dialog_history is not None
                }
            },
            "voice": {
                "available": speak_text is not None and recognize_speech_from_file is not None,
                "functions": {
                    "speak_text": speak_text is not None,
                    "recognize_speech": recognize_speech is not None,
                    "recognize_speech_from_file": recognize_speech_from_file is not None,
                    "check_vosk_model": check_vosk_model is not None
                }
            },
            "transcription": {
                "available": transcriber is not None,
                "functions": {
                    "universal_transcriber": UniversalTranscriber is not None,
                    "online_transcriber": OnlineTranscriber is not None
                }
            },
            "document_processor": {
                "available": DocumentProcessor is not None
            }
        },
        "timestamp": datetime.now().isoformat()
    }

# ================================
# СТАТИЧЕСКИЕ ФАЙЛЫ И ФРОНТЕНД
# ================================

# Подключаем статические файлы React приложения
if os.path.exists("../frontend/build"):
    app.mount("/static", StaticFiles(directory="../frontend/build/static"), name="static")
    
    @app.get("/{path:path}")
    async def serve_react_app(path: str):
        """Отдаем React приложение для всех остальных маршрутов"""
        index_file = "../frontend/build/index.html"
        if os.path.exists(index_file):
            return FileResponse(index_file)
        else:
            return {"message": "Frontend not built"}

if __name__ == "__main__":
    print("Запуск MemoAI Web Backend...")
    print(f"Текущая директория: {os.getcwd()}")
    print(f"Backend директория: {os.path.dirname(os.path.abspath(__file__))}")
    print(f"Корневая директория: {os.path.dirname(os.path.dirname(os.path.abspath(__file__)))}")
    print(f"Python path: {sys.path[:3]}...")
    print("API документация: http://localhost:8000/docs")
    print("WebSocket: ws://localhost:8000/ws/chat")
    
    # Восстанавливаем сохраненную модель
    try:
        settings = load_app_settings()
        saved_model_path = settings.get('current_model_path')
        
        if saved_model_path and os.path.exists(saved_model_path) and reload_model_by_path:
            logger.info(f"Восстанавливаю сохраненную модель: {saved_model_path}")
            success = reload_model_by_path(saved_model_path)
            if success:
                logger.info(f"Модель восстановлена: {saved_model_path}")
            else:
                logger.warning(f"Не удалось восстановить модель: {saved_model_path}")
        else:
            logger.info("Нет сохраненной модели для восстановления")
    except Exception as e:
        logger.error(f"Ошибка восстановления модели: {e}")
    
    uvicorn.run(
        app,  # Передаем объект app напрямую
        host="0.0.0.0",
        port=8000,
        reload=False,  # Отключаем reload для избежания проблем
        log_level="info"
    )

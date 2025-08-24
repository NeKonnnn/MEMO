"""
Конфигурация сервера для MemoAI Backend
Настройки FastAPI, CORS, Socket.IO и других параметров
"""

import os
from typing import List

# ================================
# НАСТРОЙКИ СЕРВЕРА
# ================================

# Основные настройки сервера
SERVER_CONFIG = {
    "host": os.getenv("MEMOAI_HOST", "0.0.0.0"),
    "port": int(os.getenv("MEMOAI_PORT", "8000")),
    "reload": os.getenv("MEMOAI_RELOAD", "false").lower() == "true",
    "log_level": os.getenv("MEMOAI_LOG_LEVEL", "info"),
    "workers": int(os.getenv("MEMOAI_WORKERS", "1")),
}

# Настройки FastAPI приложения
FASTAPI_CONFIG = {
    "title": "MemoAI Web API",
    "description": "Веб-интерфейс для персонального AI-ассистента MemoAI",
    "version": "1.0.0",
    "docs_url": "/docs",
    "redoc_url": "/redoc",
    "openapi_url": "/openapi.json",
}

# Настройки CORS
CORS_CONFIG = {
    "allow_origins": [
        "http://localhost:3000",      # React dev server
        "http://127.0.0.1:3000",     # React dev server (IPv4)
        "http://localhost:3001",      # React dev server (альтернативный порт)
        "http://127.0.0.1:3001",     # React dev server (альтернативный порт)
        "http://localhost:5173",      # Vite dev server
        "http://127.0.0.1:5173",     # Vite dev server (IPv4)
        "http://localhost:8080",      # Альтернативный порт
        "http://127.0.0.1:8080",     # Альтернативный порт
    ],
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
    "expose_headers": ["*"],
}

# Настройки Socket.IO
SOCKETIO_CONFIG = {
    "async_mode": "asgi",
    "cors_allowed_origins": [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    "ping_timeout": 120,      # ping timeout до 2 минут
    "ping_interval": 25,      # Отправляем ping каждые 25 секунд
    "logger": True,           # Включаем логирование для отладки
    "engineio_logger": True,  # Включаем логирование engine.io
    "max_http_buffer_size": 1e8,  # 100MB максимальный размер сообщения
}

# Настройки логирования
LOGGING_CONFIG = {
    "level": "DEBUG",
    "format": "[%(asctime)s] %(levelname)s [Backend] %(message)s",
    "datefmt": "%Y-%m-%d %H:%M:%S",
    "file": {
        "enabled": os.getenv("MEMOAI_LOG_FILE", "false").lower() == "true",
        "path": os.getenv("MEMOAI_LOG_PATH", "logs/backend.log"),
        "max_size": int(os.getenv("MEMOAI_LOG_MAX_SIZE", "10")),  # MB
        "backup_count": int(os.getenv("MEMOAI_LOG_BACKUP_COUNT", "5")),
    }
}

# Настройки WebSocket
WEBSOCKET_CONFIG = {
    "max_message_size": 1024 * 1024,  # 1MB максимальный размер сообщения
    "ping_interval": 20,               # 20 секунд
    "ping_timeout": 10,                # 10 секунд
}

# Настройки статических файлов
STATIC_CONFIG = {
    "frontend_build_path": "../frontend/build",
    "static_url": "/static",
    "static_dir": "../frontend/build/static",
}

# Настройки безопасности
SECURITY_CONFIG = {
    "rate_limit_enabled": os.getenv("MEMOAI_RATE_LIMIT", "false").lower() == "true",
    "rate_limit_requests": int(os.getenv("MEMOAI_RATE_LIMIT_REQUESTS", "100")),
    "rate_limit_window": int(os.getenv("MEMOAI_RATE_LIMIT_WINDOW", "60")),  # секунды
    "max_upload_size": int(os.getenv("MEMOAI_MAX_UPLOAD_SIZE", "100")),    # MB
}

# Настройки моделей
MODEL_CONFIG = {
    "default_engine": "whisperx",
    "default_language": "ru",
    "auto_detect_language": True,
    "max_context_size": 32768,
    "max_output_tokens": 2048,
}

# ================================
# ФУНКЦИИ КОНФИГУРАЦИИ
# ================================

def get_server_url() -> str:
    """Получить полный URL сервера"""
    host = SERVER_CONFIG["host"]
    port = SERVER_CONFIG["port"]
    
    if host == "0.0.0.0":
        host = "localhost"
    
    return f"http://{host}:{port}"

def get_websocket_url() -> str:
    """Получить WebSocket URL"""
    host = SERVER_CONFIG["host"]
    port = SERVER_CONFIG["port"]
    
    if host == "0.0.0.0":
        host = "localhost"
    
    return f"ws://{host}:{port}"

def get_cors_origins() -> List[str]:
    """Получить список разрешенных CORS origins"""
    origins = CORS_CONFIG["allow_origins"].copy()
    
    # Добавляем переменные окружения, если они есть
    env_origins = os.getenv("MEMOAI_CORS_ORIGINS", "")
    if env_origins:
        origins.extend(env_origins.split(","))
    
    return list(set(origins))  # Убираем дубликаты

def get_socketio_cors_origins() -> List[str]:
    """Получить список разрешенных CORS origins для Socket.IO"""
    origins = SOCKETIO_CONFIG["cors_allowed_origins"].copy()
    
    # Добавляем переменные окружения, если они есть
    env_origins = os.getenv("MEMOAI_SOCKETIO_CORS_ORIGINS", "")
    if env_origins:
        origins.extend(env_origins.split(","))
    
    return list(set(origins))  # Убираем дубликаты

def get_logging_config() -> dict:
    """Получить конфигурацию логирования"""
    config = LOGGING_CONFIG.copy()
    
    # Переопределяем уровень логирования из переменных окружения
    env_level = os.getenv("MEMOAI_LOG_LEVEL")
    if env_level:
        config["level"] = env_level.upper()
    
    return config

def get_uvicorn_config() -> dict:
    """Получить конфигурацию для uvicorn"""
    return {
        "host": SERVER_CONFIG["host"],
        "port": SERVER_CONFIG["port"],
        "reload": SERVER_CONFIG["reload"],
        "log_level": SERVER_CONFIG["log_level"],
        "workers": SERVER_CONFIG["workers"],
        "access_log": True,
        "use_colors": True,
    }

# ================================
# ПРОВЕРКА КОНФИГУРАЦИИ
# ================================

def validate_config() -> bool:
    """Проверить корректность конфигурации"""
    try:
        # Проверяем порт
        port = SERVER_CONFIG["port"]
        if not (1 <= port <= 65535):
            print(f"❌ Некорректный порт: {port}")
            return False
        
        # Проверяем уровень логирования
        log_level = SERVER_CONFIG["log_level"]
        valid_levels = ["debug", "info", "warning", "error", "critical"]
        if log_level not in valid_levels:
            print(f"❌ Некорректный уровень логирования: {log_level}")
            return False
        
        # Проверяем CORS origins
        if not get_cors_origins():
            print("❌ Не указаны разрешенные CORS origins")
            return False
        
        print("✅ Конфигурация сервера корректна")
        return True
        
    except Exception as e:
        print(f"❌ Ошибка валидации конфигурации: {e}")
        return False

def print_config_summary():
    """Вывести краткую сводку конфигурации"""
    print("=" * 50)
    print("🔧 КОНФИГУРАЦИЯ MEMOAI BACKEND")
    print("=" * 50)
    print(f"🌐 Сервер: {get_server_url()}")
    print(f"🔌 WebSocket: {get_websocket_url()}")
    print(f"📝 Документация: {get_server_url()}/docs")
    print(f"📊 ReDoc: {get_server_url()}/redoc")
    print(f"🔒 CORS Origins: {len(get_cors_origins())} разрешенных")
    print(f"📡 Socket.IO: {len(get_socketio_cors_origins())} разрешенных")
    print(f"📁 Логирование: {get_logging_config()['level']}")
    print(f"🔄 Автоперезагрузка: {'Включена' if SERVER_CONFIG['reload'] else 'Отключена'}")
    print("=" * 50)

if __name__ == "__main__":
    # Тестирование конфигурации
    if validate_config():
        print_config_summary()
    else:
        print("❌ Конфигурация некорректна")

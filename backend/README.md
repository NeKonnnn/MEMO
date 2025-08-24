# MemoAI Backend

Backend сервер для MemoAI - персонального AI ассистента.

## Настройка

### Переменные окружения

Создайте файл `.env` в корне backend папки со следующими настройками:

```bash
# Основные настройки сервера
MEMOAI_HOST=0.0.0.0
MEMOAI_PORT=8000
MEMOAI_RELOAD=false
MEMOAI_LOG_LEVEL=info
MEMOAI_WORKERS=1

# Настройки CORS
MEMOAI_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
MEMOAI_SOCKETIO_CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# Настройки логирования
MEMOAI_LOG_FILE=false
MEMOAI_LOG_PATH=logs/backend.log
MEMOAI_LOG_MAX_SIZE=10
MEMOAI_LOG_BACKUP_COUNT=5

# Настройки безопасности
MEMOAI_RATE_LIMIT=false
MEMOAI_RATE_LIMIT_REQUESTS=100
MEMOAI_RATE_LIMIT_WINDOW=60
MEMOAI_MAX_UPLOAD_SIZE=100

# Настройки моделей
MEMOAI_DEFAULT_ENGINE=whisperx
MEMOAI_DEFAULT_LANGUAGE=ru
MEMOAI_AUTO_DETECT_LANGUAGE=true
MEMOAI_MAX_CONTEXT_SIZE=32768
MEMOAI_MAX_OUTPUT_TOKENS=2048
```

### Структура конфигурации

Все настройки сервера определены в `config/server.py`:

- **SERVER_CONFIG**: Основные настройки сервера (host, port, reload)
- **FASTAPI_CONFIG**: Настройки FastAPI приложения
- **CORS_CONFIG**: Настройки CORS для веб-приложений
- **SOCKETIO_CONFIG**: Настройки Socket.IO сервера
- **LOGGING_CONFIG**: Настройки логирования
- **WEBSOCKET_CONFIG**: Настройки WebSocket соединений
- **STATIC_CONFIG**: Настройки статических файлов
- **SECURITY_CONFIG**: Настройки безопасности
- **MODEL_CONFIG**: Настройки AI моделей

### Запуск сервера

```bash
# Активируйте виртуальную среду
source myvenv/bin/activate  # Linux/Mac
# или
myvenv\Scripts\activate      # Windows

# Запустите сервер
python main.py
```

### Проверка конфигурации

```bash
# Проверьте конфигурацию
python config/server.py
```

## API Endpoints

### Основные
- `GET /` - Главная страница API
- `GET /health` - Проверка состояния системы
- `GET /socket-test` - Тест Socket.IO

### Чат
- `POST /api/chat` - Отправка сообщения AI
- `WebSocket /ws/chat` - Потоковый чат

### Голос
- `POST /api/voice/recognize` - Распознавание речи
- `POST /api/voice/synthesize` - Синтез речи
- `GET /api/voice/settings` - Настройки голоса
- `PUT /api/voice/settings` - Обновление настроек голоса

### Транскрибация
- `POST /api/transcribe/upload` - Загрузка файла для транскрибации
- `POST /api/transcribe/youtube` - Транскрибация YouTube видео
- `GET /api/transcription/settings` - Настройки транскрибации
- `PUT /api/transcription/settings` - Обновление настроек

### Документы
- `POST /api/documents/upload` - Загрузка документа
- `POST /api/documents/query` - Запрос к документу

### Модели
- `GET /api/models` - Список доступных моделей
- `GET /api/models/current` - Текущая загруженная модель
- `GET /api/models/settings` - Настройки модели
- `PUT /api/models/settings` - Обновление настроек модели
- `POST /api/models/load` - Загрузка модели

### История
- `GET /api/history` - История диалогов
- `DELETE /api/history` - Очистка истории

### Система
- `GET /api/system/status` - Статус всех модулей

## WebSocket Events

### Socket.IO
- `chat_chunk` - Фрагмент ответа AI
- `chat_complete` - Завершение ответа AI
- `chat_error` - Ошибка в чате

### WebSocket
- `/ws/chat` - Потоковый чат
- `/ws/voice` - Голосовое взаимодействие

## Логирование

Логи настраиваются через переменные окружения:

- `MEMOAI_LOG_LEVEL`: Уровень логирования (debug, info, warning, error, critical)
- `MEMOAI_LOG_FILE`: Включить/отключить запись в файл
- `MEMOAI_LOG_PATH`: Путь к файлу логов
- `MEMOAI_LOG_MAX_SIZE`: Максимальный размер файла логов (MB)
- `MEMOAI_LOG_BACKUP_COUNT`: Количество резервных копий

## Безопасность

- **Rate Limiting**: Ограничение количества запросов
- **CORS**: Настройка разрешенных origins
- **File Upload Limits**: Ограничение размера загружаемых файлов
- **Input Validation**: Валидация входных данных

## Разработка

### Включение автоперезагрузки
```bash
MEMOAI_RELOAD=true python main.py
```

### Отладка
```bash
MEMOAI_LOG_LEVEL=debug python main.py
```

### Тестирование
```bash
# Проверка конфигурации
python config/server.py

# Запуск тестов (если есть)
python -m pytest tests/
```

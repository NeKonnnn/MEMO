# MemoAI - Полное руководство по переносу проекта

## Описание проекта

MemoAI - это интеллектуальная система для обработки аудио, транскрипции и анализа речи с использованием современных AI моделей. Проект включает в себя:

- **Backend**: Python FastAPI сервер с интеграцией WhisperX, Pyannote диаризации и различных LLM моделей
- **Frontend**: React TypeScript приложение с Material-UI
- **AI модели**: Локальные модели для транскрипции, диаризации и генерации текста
- **Docker**: Контейнеризация для упрощения развертывания

## Быстрый старт

### Предварительные требования

- **Python 3.12+** (рекомендуется)
- **Node.js 18+** и npm
- **Git**
- **Docker** и Docker Compose (опционально)
- **Минимум 8GB RAM** (для работы с AI моделями)
- **Минимум 20GB свободного места** на диске

## Установка и настройка

### 1. Клонирование репозитория

```bash
git clone <your-repository-url>
cd memoai
```

### 2. Настройка Python окружения

```bash
# Создание виртуального окружения
python -m venv venv_312

# Активация в Windows
venv_312\Scripts\activate

# Активация в Linux/Mac
source venv_312/bin/activate

# Установка зависимостей
pip install -r requirements.txt
```

### 3. Настройка фронтенда

```bash
cd frontend

# Установка зависимостей
npm install

# Сборка для продакшена
npm run build
```

### 4. Настройка переменных окружения

# Настройки AI моделей
MODEL_PATH=./models
WHISPERX_MODEL_PATH=./whisperx_models
DIARIZATION_MODEL_PATH=./diarize_models

# Настройки безопасности
SECRET_KEY=your_secret_key_here
CORS_ORIGINS=["http://localhost:3000", "http://your-domain.com"]
```

## Зависимости проекта

### Python зависимости (Backend)

Основные библиотеки, которые будут установлены автоматически:

- **FastAPI** - веб-фреймворк
- **WhisperX** - транскрипция аудио
- **Pyannote** - диаризация спикеров
- **PyTorch** - машинное обучение
- **Transformers** - Hugging Face модели
- **Uvicorn** - ASGI сервер
- **SQLAlchemy** - ORM для базы данных

Полный список зависимостей находится в `requirements.txt`

### Node.js зависимости (Frontend)

Основные библиотеки:

- **React 19** - UI библиотека
- **TypeScript** - типизированный JavaScript
- **Material-UI** - компоненты интерфейса
- **Axios** - HTTP клиент
- **Socket.io** - веб-сокеты
- **React Router** - маршрутизация

Полный список зависимостей находится в `frontend/package.json`

## Развертывание с Docker

### 1. Сборка образов

```bash
# Сборка backend
docker build -t memoai-backend ./backend

# Сборка frontend
docker build -t memoai-frontend ./frontend

# Или сборка всех сервисов
docker-compose build
```

### 2. Запуск с Docker Compose

```bash
docker-compose up -d
```

### 3. Проверка статуса

```bash
docker-compose ps
docker-compose logs -f
```

## Перенос на новый сервер

### Пошаговый план миграции

#### Шаг 1: Подготовка исходного сервера

```bash
# Создание архива проекта
tar -czf memoai_backup_$(date +%Y%m%d_%H%M%S).tar.gz \
    --exclude=venv* \
    --exclude=__pycache__ \
    --exclude=*.pyc \
    --exclude=node_modules \
    --exclude=build \
    --exclude=dist \
    --exclude=.git \
    .

# Или для Windows PowerShell
Compress-Archive -Path . -DestinationPath "memoai_backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').zip" -Exclude @("venv*", "__pycache__", "*.pyc", "node_modules", "build", "dist", ".git")
```

#### Шаг 2: Перенос на новый сервер

```bash
# Копирование архива
scp memoai_backup_*.tar.gz user@new-server:/path/to/destination/

# На новом сервере - распаковка
tar -xzf memoai_backup_*.tar.gz
cd memoai
```

#### Шаг 3: Настройка нового окружения

```bash
# Установка системных зависимостей (Ubuntu/Debian)
sudo apt update
sudo apt install -y python3.12 python3.12-venv python3.12-dev
sudo apt install -y nodejs npm
sudo apt install -y ffmpeg portaudio19-dev
sudo apt install -y build-essential

# Установка системных зависимостей (CentOS/RHEL)
sudo yum install -y python3.12 python3.12-devel
sudo yum install -y nodejs npm
sudo yum install -y ffmpeg portaudio-devel
sudo yum install -y gcc gcc-c++ make

# Создание и активация виртуального окружения
python3.12 -m venv venv_312
source venv_312/bin/activate

# Установка Python зависимостей
pip install --upgrade pip
pip install -r requirements.txt
```

#### Шаг 4: Настройка фронтенда

```bash
cd frontend

# Установка Node.js зависимостей
npm install

# Сборка для продакшена
npm run build
```

#### Шаг 5: Настройка переменных окружения

```bash
# Копирование примера конфигурации
cp env.example .env

# Редактирование конфигурации
nano .env
```

#### Шаг 6: Запуск сервисов

```bash
# Запуск backend
cd backend
python main.py

# В новом терминале - запуск frontend
cd frontend
npm start
```

## Продакшн развертывание

### 1. Настройка systemd сервисов

Создайте файл `/etc/systemd/system/memoai-backend.service`:

```ini
[Unit]
Description=MemoAI Backend Service
After=network.target

[Service]
Type=simple
User=memoai
WorkingDirectory=/path/to/memoai/backend
Environment=PATH=/path/to/memoai/venv_312/bin
ExecStart=/path/to/memoai/venv_312/bin/python main.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 2. Настройка Nginx

Создайте файл `/etc/nginx/sites-available/memoai`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Frontend
    location / {
        root /path/to/memoai/frontend/build;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket поддержка
    location /ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

### 3. Активация сервисов

```bash
# Активация systemd сервиса
sudo systemctl enable memoai-backend
sudo systemctl start memoai-backend

# Активация Nginx конфигурации
sudo ln -s /etc/nginx/sites-available/memoai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Устранение неполадок

### Частые проблемы

#### 1. Ошибки с PyTorch

```bash
# Переустановка PyTorch с CPU версией
pip uninstall torch torchaudio
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
```

#### 2. Проблемы с аудио

```bash
# Установка системных аудио библиотек
sudo apt install -y libasound2-dev portaudio19-dev
sudo apt install -y ffmpeg

# Проверка аудио устройств
python -c "import sounddevice; print(sounddevice.query_devices())"
```

#### 3. Проблемы с моделями

```bash
# Проверка путей к моделям
ls -la models/
ls -la whisperx_models/
ls -la diarize_models/

# Перезагрузка моделей
python -c "from whisperx_transcriber import WhisperXTranscriber; t = WhisperXTranscriber()"
```

### Логи и отладка

```bash
# Просмотр логов backend
tail -f backend/logs/app.log

# Просмотр логов systemd
sudo journalctl -u memoai-backend -f

# Просмотр логов Nginx
sudo tail -f /var/log/nginx/error.log
```

## Мониторинг и производительность

### 1. Мониторинг ресурсов

```bash
# Мониторинг использования памяти
htop
free -h

# Мониторинг дискового пространства
df -h
du -sh models/ whisperx_models/ diarize_models/
```

### 2. Оптимизация производительности

- **Использование GPU**: Установите CUDA версию PyTorch для ускорения
- **Кэширование моделей**: Настройте кэширование Hugging Face моделей
- **Оптимизация аудио**: Настройте качество аудио в зависимости от требований

## Безопасность

### 1. Настройка файрвола

```bash
# UFW (Ubuntu)
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# Firewalld (CentOS/RHEL)
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### 2. SSL сертификаты

```bash
# Установка Certbot
sudo apt install certbot python3-certbot-nginx

# Получение SSL сертификата
sudo certbot --nginx -d your-domain.com
```

## Обновление проекта

### 1. Обновление зависимостей

```bash
# Python зависимости
source venv_312/bin/activate
pip install --upgrade -r requirements.txt

# Node.js зависимости
cd frontend
npm update
npm run build
```

### 2. Обновление AI моделей

```bash
# Обновление WhisperX моделей
python -c "import whisperx; whisperx.load_model('large-v3')"

# Обновление диаризации моделей
python -c "from pyannote.audio import Pipeline; Pipeline.from_pretrained('pyannote/speaker-diarization-3.1')"
```

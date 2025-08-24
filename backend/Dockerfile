# Dockerfile для MemoAI Backend
FROM python:3.11-slim

# Установка системных зависимостей
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    git \
    wget \
    curl \
    libsndfile1 \
    portaudio19-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Установка рабочей директории
WORKDIR /app

# Копирование requirements.txt
COPY requirements.txt .

# Установка Python зависимостей
RUN pip install --no-cache-dir -r requirements.txt

# Копирование исходного кода
COPY . .

# Создание необходимых директорий
RUN mkdir -p /app/models /app/model_small /app/silero_models /app/memory

# Установка переменных окружения
ENV PYTHONPATH=/app
ENV MODEL_PATH=/app/models/model.gguf

# Открытие порта
EXPOSE 8000

# Команда запуска
CMD ["python", "main.py"]

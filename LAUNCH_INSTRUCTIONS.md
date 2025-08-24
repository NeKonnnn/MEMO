# 🚀 Инструкция по запуску MemoAI

## 📋 Что изменилось

После рефакторинга конфигурации backend, теперь у вас есть несколько способов запуска приложения:

## 🎯 Способы запуска

### 1. **Обычный запуск (рекомендуется)**
```bash
# Просто дважды кликните на:
start.bat
```

### 2. **Расширенный запуск с выбором режима**
```bash
# Дважды кликните на:
start_advanced.bat
```

**Доступные режимы:**
- `1` - Обычный запуск
- `2` - С автоперезагрузкой backend
- `3` - С отладкой backend
- `4` - Только backend
- `5` - Только frontend

### 3. **PowerShell запуск (для продвинутых)**
```powershell
# Обычный запуск
.\start.ps1

# С автоперезагрузкой
.\start.ps1 -Reload

# С отладкой
.\start.ps1 -Debug

# Только backend
.\start.ps1 -BackendOnly

# Только frontend
.\start.ps1 -FrontendOnly

# Справка
.\start.ps1 -Help
```

## ⚙️ Автоматическая настройка

Все скрипты автоматически:

1. ✅ Проверяют наличие необходимых файлов
2. ✅ Создают `.env` файлы из примеров
3. ✅ Проверяют корректность конфигурации backend
4. ✅ Активируют виртуальную среду
5. ✅ Запускают серверы в правильном порядке

## 🔧 Ручная настройка (если нужно)

### Backend настройки
```bash
cd backend
copy env.example .env
# Отредактируйте .env файл
```

### Frontend настройки
```bash
cd frontend
copy .env.example .env
# Отредактируйте .env файл
```

## 🌐 Доступные URL после запуска

- **Frontend приложение**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API документация**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## 🛑 Остановка серверов

### Способ 1: Закрытие окон
- Закройте окно "MemoAI Backend"
- Закройте окно "MemoAI Frontend"

### Способ 2: Ctrl+C
- В окне backend нажмите `Ctrl+C`
- В окне frontend нажмите `Ctrl+C`

## 🔍 Отладка

### Проверка конфигурации backend
```bash
cd backend
python config/server.py
```

### Логи backend
- Уровень логирования настраивается в `backend\.env`
- `MEMOAI_LOG_LEVEL=debug` для подробных логов

### Логи frontend
- Откройте Developer Tools в браузере (F12)
- Перейдите на вкладку Console

## ❗ Возможные проблемы

### 1. Виртуальная среда не найдена
```bash
python -m venv myvenv
```

### 2. Зависимости не установлены
```bash
myvenv\Scripts\activate
pip install -r requirements_venv312.txt
```

### 3. Frontend зависимости не установлены
```bash
cd frontend
npm install
```

### 4. Порт занят
Измените порт в `backend\.env`:
```bash
MEMOAI_PORT=8080
```

## 📱 Быстрый старт

1. **Убедитесь, что у вас есть:**
   - Python 3.9+
   - Node.js 16+
   - Git

2. **Клонируйте репозиторий:**
   ```bash
   git clone <your-repo>
   cd memoai
   ```

3. **Создайте виртуальную среду:**
   ```bash
   python -m venv myvenv
   ```

4. **Установите зависимости:**
   ```bash
   myvenv\Scripts\activate
   pip install -r requirements_venv312.txt
   cd frontend
   npm install
   cd ..
   ```

5. **Запустите приложение:**
   ```bash
   # Просто дважды кликните на:
   start.bat
   ```

## 🎉 Готово!

После успешного запуска:
- Frontend будет доступен по адресу http://localhost:3000
- Backend API будет доступен по адресу http://localhost:8000
- Браузер автоматически откроется с приложением

---

**Приятного использования MemoAI! 🚀**

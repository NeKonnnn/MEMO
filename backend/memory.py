from backend.config.config import MEMORY_PATH
import json
import os

# Формируем полные пути к файлам
MEMORY_FILE = os.path.join(MEMORY_PATH, "dialog_history.txt")
DIALOG_FILE = os.path.join(MEMORY_PATH, "dialog_history_dialog.json")

def save_to_memory(role, message):
    """Сохраняет сообщение в память в простом формате"""
    with open(MEMORY_FILE, "a", encoding="utf-8") as f:
        f.write(f"{role}: {message}\n")

def save_dialog_entry(role, content):
    """Сохраняет сообщение в формате диалога для передачи в модель"""
    import datetime
    
    # Загружаем существующую историю или создаем новую
    dialog_history = []
    if os.path.exists(DIALOG_FILE):
        try:
            with open(DIALOG_FILE, "r", encoding="utf-8") as f:
                dialog_history = json.load(f)
        except:
            dialog_history = []
    
    # Добавляем новое сообщение с временной меткой
    dialog_history.append({
        "role": role,
        "content": content,
        "timestamp": datetime.datetime.now().isoformat()  # Полный формат ISO для API
    })
    
    # Сохраняем обновленную историю
    try:
        with open(DIALOG_FILE, "w", encoding="utf-8") as f:
            json.dump(dialog_history, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"Ошибка при сохранении истории диалога: {e}")

def load_history():
    """Загружает простую историю в текстовом формате"""
    try:
        with open(MEMORY_FILE, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""

def load_dialog_history():
    """Загружает историю диалога в формате для передачи в модель"""
    if os.path.exists(DIALOG_FILE):
        try:
            with open(DIALOG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except:
            return []
    return []

def clear_dialog_history():
    """Очищает историю диалога"""
    if os.path.exists(DIALOG_FILE):
        os.remove(DIALOG_FILE)
    if os.path.exists(MEMORY_FILE):
        os.remove(MEMORY_FILE)
    return "История диалога очищена"

def get_recent_dialog_history(max_entries=10):
    """Возвращает последние N сообщений из истории диалога"""
    history = load_dialog_history()
    return history[-max_entries:] if len(history) > max_entries else history
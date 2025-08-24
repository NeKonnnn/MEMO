from llama_cpp import Llama
from config import MODEL_PATH
import os
import glob
import json

# Класс для хранения настроек модели
class ModelSettings:
    def __init__(self):
        self.settings_file = "llm_settings.json"
        # Настройки модели по умолчанию
        self.default_settings = {
            "context_size": 2048,      # Размер контекста
            "output_tokens": 512,      # Размер выходного текста
            "batch_size": 512,         # Размер батча
            "n_threads": 2,            # Количество потоков
            "use_mmap": True,          # Использовать mmap
            "use_mlock": False,        # Блокировать в памяти
            "verbose": True,           # Подробный вывод
            "temperature": 0.7,        # Температура генерации
            "top_p": 0.95,             # Top-p sampling
            "repeat_penalty": 1.05,    # Штраф за повторения
            "use_gpu": False,          # Использовать GPU
            "streaming": True,         # Использовать потоковую генерацию
            "legacy_api": False        # Режим совместимости для несовместимых архитектур
        }
        self.settings = self.default_settings.copy()
        self.load_settings()
    
    def load_settings(self):
        """Загрузка настроек из файла"""
        try:
            if os.path.exists(self.settings_file):
                with open(self.settings_file, 'r', encoding='utf-8') as f:
                    loaded_settings = json.load(f)
                    self.settings.update(loaded_settings)
                print("Настройки модели загружены")
        except Exception as e:
            print(f"Ошибка при загрузке настроек модели: {str(e)}")
    
    def save_settings(self):
        """Сохранение настроек в файл"""
        try:
            with open(self.settings_file, 'w', encoding='utf-8') as f:
                json.dump(self.settings, f, indent=2, ensure_ascii=False)
            print("Настройки модели сохранены")
        except Exception as e:
            print(f"Ошибка при сохранении настроек модели: {str(e)}")
    
    def get(self, key, default=None):
        """Получение значения настройки"""
        return self.settings.get(key, default)
    
    def set(self, key, value):
        """Установка значения настройки"""
        if key in self.settings:
            self.settings[key] = value
            self.save_settings()
            return True
        return False
    
    def reset_to_defaults(self):
        """Сброс настроек к значениям по умолчанию"""
        self.settings = self.default_settings.copy()
        self.save_settings()
    
    def get_all(self):
        """Получение всех настроек"""
        return self.settings.copy()

# Создаем экземпляр класса настроек
model_settings = ModelSettings()

# Настройки модели
MODEL_CONTEXT_SIZE = model_settings.get("context_size")
DEFAULT_OUTPUT_TOKENS = model_settings.get("output_tokens")
VERBOSE_OUTPUT = model_settings.get("verbose")

# Поиск доступных моделей
def find_available_model():
    models_dir = os.path.join(os.path.dirname(__file__), 'models')
    if not os.path.exists(models_dir):
        print(f"Директория с моделями не существует: {models_dir}")
        return None
    
    # Ищем модели с расширением .gguf
    model_files = glob.glob(os.path.join(models_dir, '*.gguf'))
    if model_files:
        print(f"Найдена модель: {model_files[0]}")
        return model_files[0]
    
    print("Модели в формате GGUF не найдены в директории models/")
    return None

# Инициализация модели с проверкой существования файла
llm = None

def initialize_model():
    """Инициализация модели с текущими настройками"""
    global llm
    
    # Освобождаем ресурсы, если модель уже была загружена
    if llm is not None:
        try:
            # Сохраняем ссылку, чтобы очистить её позже
            old_llm = llm
            # Сбрасываем глобальную переменную перед удалением
            llm = None
            # Явно удаляем объект
            del old_llm
            
            # Вызываем сборщик мусора несколько раз
            import gc
            gc.collect()
            # Ждем некоторое время перед продолжением
            import time
            time.sleep(1)
            # Повторяем еще раз для уверенности
            gc.collect()
            
            print("Предыдущая модель успешно выгружена из памяти")
        except Exception as e:
            print(f"Ошибка при освобождении ресурсов: {str(e)}")
            # Продолжаем, даже если не удалось освободить ресурсы
        
    try:
        model_to_use = MODEL_PATH
        if not os.path.exists(model_to_use):
            print(f"ПРЕДУПРЕЖДЕНИЕ: Модель по указанному пути не найдена: {model_to_use}")
            model_to_use = find_available_model()
        
        if model_to_use and os.path.exists(model_to_use):
            use_gpu = model_settings.get("use_gpu", False)
            device_type = "GPU" if use_gpu else "CPU"
            print(f"Загружаю модель из: {model_to_use} (устройство: {device_type})")
            
            # Проверяем файл модели на наличие архитектуры
            # Это помогает определить, нужно ли использовать legacy_api
            legacy_mode = False
            try:
                # Импортируем функцию для чтения метаданных модели
                from llama_cpp.llama_grammar import LlamaGrammar
                import json
                import struct
                
                # Проверяем, является ли файл GGUF форматом
                with open(model_to_use, "rb") as f:
                    magic = f.read(4)
                    if magic == b"GGUF":
                        # Файл в формате GGUF, читаем метаданные для определения архитектуры
                        f.seek(0)
                        # Пропускаем magic + version + metadata_kv_count
                        f.read(4 + 4 + 8)
                        try:
                            # Пытаемся прочитать ключи метаданных
                            architecture_found = False
                            for _ in range(100):  # Ограничиваем количество итераций для безопасности
                                # Чтение длины ключа
                                key_length_bytes = f.read(8)
                                if not key_length_bytes:
                                    break
                                key_length = int.from_bytes(key_length_bytes, byteorder='little')
                                
                                # Чтение ключа
                                key = f.read(key_length).decode('utf-8')
                                
                                # Чтение типа значения
                                value_type = int.from_bytes(f.read(4), byteorder='little')
                                
                                if key == "general.architecture":
                                    # Чтение длины значения (для строк)
                                    if value_type == 3:  # STRING
                                        value_length = int.from_bytes(f.read(8), byteorder='little')
                                        value = f.read(value_length).decode('utf-8')
                                        print(f"Обнаружена архитектура: {value}")
                                        
                                        # Проверяем, поддерживается ли архитектура
                                        unsupported_archs = ["qwen", "qwen2", "qwen3", "phi", "yi", "mamba"]
                                        if any(arch in value.lower() for arch in unsupported_archs):
                                            print(f"Архитектура {value} может быть несовместима с llama-cpp напрямую, "
                                                  f"будет использован режим совместимости")
                                            legacy_mode = True
                                        architecture_found = True
                                        break
                                    else:
                                        # Пропускаем значение
                                        f.seek(f.tell() + 8)  # Пропускаем размер значения
                                else:
                                    # Пропускаем значение
                                    f.seek(f.tell() + 12)  # Пропускаем тип, размер и значение
                            
                            if not architecture_found:
                                print("Архитектура не найдена в метаданных, будет использован обычный режим")
                        except Exception as e:
                            print(f"Ошибка при чтении метаданных модели: {str(e)}")
            except Exception as e:
                print(f"Не удалось проверить архитектуру модели: {str(e)}")
            
            try:
                # Перед созданием новой модели вызываем сборщик мусора
                import gc
                gc.collect()
                
                # Параметры для модели с текущими настройками
                # Если модель несовместима, используем legacy_api=True
                use_legacy_api = model_settings.get("legacy_api", False) or legacy_mode
                if use_legacy_api:
                    print(f"Используется режим совместимости (legacy_api=True) для загрузки модели")
                
                llm = Llama(
                    model_path=model_to_use,
                    n_ctx=model_settings.get("context_size"),
                    n_batch=model_settings.get("batch_size"),
                    use_mmap=model_settings.get("use_mmap"),
                    use_mlock=model_settings.get("use_mlock"),
                    verbose=model_settings.get("verbose"),
                    seed=42,                          # Фиксированное зерно для стабильности
                    n_threads=model_settings.get("n_threads"),
                    use_gpu=use_gpu,
                    legacy_api=use_legacy_api         # Режим совместимости для несовместимых архитектур
                )
                print(f"Модель успешно загружена на {device_type} с контекстным окном {model_settings.get('context_size')} токенов!")
                return True
            except Exception as e:
                print(f"ОШИБКА: Не удалось загрузить модель: {str(e)}")
                
                # Если ошибка связана с архитектурой и мы не используем режим совместимости,
                # попробуем еще раз с включенным режимом
                if not use_legacy_api and "unknown model architecture" in str(e):
                    print("Обнаружена несовместимая архитектура. Повторная попытка с режимом совместимости...")
                    try:
                        llm = Llama(
                            model_path=model_to_use,
                            n_ctx=model_settings.get("context_size"),
                            n_batch=model_settings.get("batch_size"),
                            use_mmap=model_settings.get("use_mmap"),
                            use_mlock=model_settings.get("use_mlock"),
                            verbose=model_settings.get("verbose"),
                            seed=42,
                            n_threads=model_settings.get("n_threads"),
                            use_gpu=use_gpu,
                            legacy_api=True    # Принудительно включаем режим совместимости
                        )
                        print(f"Модель успешно загружена в режиме совместимости на {device_type}!")
                        return True
                    except Exception as e2:
                        print(f"ОШИБКА при повторной попытке с режимом совместимости: {str(e2)}")
                
                # Сбрасываем глобальную переменную, если произошла ошибка во время загрузки
                llm = None
                # Принудительно вызываем сборщик мусора
                gc.collect()
                raise
        else:
            print("ОШИБКА: Не удалось найти подходящую модель.")
            raise ValueError("Модель не найдена")
    except Exception as e:
        print(f"ОШИБКА при загрузке модели: {str(e)}")
        raise

try:
    initialize_model()
except Exception as e:
    print(f"ОШИБКА при инициализации модели: {str(e)}")

def update_model_settings(new_settings):
    """Обновление настроек модели и перезагрузка"""
    global model_settings, MODEL_CONTEXT_SIZE, DEFAULT_OUTPUT_TOKENS, VERBOSE_OUTPUT
    
    # Обновляем настройки
    for key, value in new_settings.items():
        model_settings.set(key, value)
    
    # Обновляем глобальные переменные
    MODEL_CONTEXT_SIZE = model_settings.get("context_size")
    DEFAULT_OUTPUT_TOKENS = model_settings.get("output_tokens")
    VERBOSE_OUTPUT = model_settings.get("verbose")
    
    # Перезагружаем модель с новыми настройками
    return initialize_model()

def reload_model_by_path(model_path):
    """Перезагрузка модели с новым файлом модели"""
    global MODEL_PATH, llm
    
    # Проверяем существование файла модели
    if not os.path.exists(model_path):
        print(f"ОШИБКА: Модель по указанному пути не найдена: {model_path}")
        return False
    
    # Если текущая модель та же самая, возвращаем успех без перезагрузки
    if MODEL_PATH == model_path and llm is not None:
        print(f"Модель {model_path} уже загружена, перезагрузка не требуется")
        return True
    
    try:
        # Принудительный сброс всех ссылок на модель перед сменой
        if llm is not None:
            try:
                # Сохраняем ссылку, чтобы очистить её позже
                old_llm = llm
                # Сбрасываем глобальную переменную перед удалением
                llm = None
                # Явно удаляем объект
                del old_llm
                
                # Запускаем сборщик мусора несколько раз
                import gc
                gc.collect()
                # Ждем некоторое время перед продолжением
                import time
                time.sleep(1)
                # Повторяем еще раз для уверенности
                gc.collect()
                
                print("Предыдущая модель успешно выгружена из памяти")
            except Exception as e:
                print(f"Ошибка при освобождении ресурсов: {str(e)}")
        
        # Делаем более длительную паузу перед загрузкой новой модели
        import time
        time.sleep(2)
        
        # Обновляем глобальный путь к модели
        MODEL_PATH = model_path
        print(f"Сменяем модель на: {model_path}")
        
        # Перезагружаем модель
        return initialize_model()
    except Exception as e:
        print(f"ОШИБКА при смене модели: {str(e)}")
        return False

def get_model_info():
    """Получение информации о текущей модели"""
    if llm is None:
        return {
            "loaded": False,
            "metadata": None,
            "path": MODEL_PATH
        }
    
    try:
        # Создаем базовую структуру метаданных
        metadata = {
            "general.name": "Неизвестно",
            "general.architecture": "Неизвестно",
            "general.size_label": "Неизвестно"
        }
        
        # Пытаемся получить информацию через метод model_metadata
        try:
            if hasattr(llm, 'model_metadata'):
                model_meta = llm.model_metadata()
                metadata.update(model_meta)
        except Exception as e:
            print(f"Предупреждение: Не удалось получить метаданные модели: {e}")
        
        # Информация о контексте
        n_ctx = 4096  # значение по умолчанию
        try:
            if hasattr(llm, 'n_ctx'):
                if callable(llm.n_ctx):
                    n_ctx = llm.n_ctx()
                else:
                    n_ctx = llm.n_ctx
        except Exception as e:
            print(f"Предупреждение: Не удалось получить размер контекста: {e}")
        
        # Слои GPU
        n_gpu_layers = 0
        try:
            if hasattr(llm, 'params') and hasattr(llm.params, 'n_gpu_layers'):
                n_gpu_layers = llm.params.n_gpu_layers
        except Exception as e:
            print(f"Предупреждение: Не удалось получить количество GPU слоев: {e}")
        
        # Получаем тип модели и имя файла для более информативного отображения
        model_filename = os.path.basename(MODEL_PATH)
        if "general.architecture" not in metadata or metadata["general.architecture"] == "Неизвестно":
            # Пытаемся определить архитектуру по имени файла
            if "llama" in model_filename.lower():
                metadata["general.architecture"] = "LLaMA"
            elif "mistral" in model_filename.lower():
                metadata["general.architecture"] = "Mistral"
            elif "qwen" in model_filename.lower():
                metadata["general.architecture"] = "Qwen"
            elif "phi" in model_filename.lower():
                metadata["general.architecture"] = "Phi"
            elif "gemma" in model_filename.lower():
                metadata["general.architecture"] = "Gemma"
        
        # Возвращаем собранную информацию
        return {
            "loaded": True,
            "metadata": metadata,
            "path": MODEL_PATH,
            "n_ctx": n_ctx,
            "n_gpu_layers": n_gpu_layers
        }
    except Exception as e:
        print(f"Ошибка при получении информации о модели: {e}")
        return {
            "loaded": True,
            "error": str(e),
            "path": MODEL_PATH,
            "metadata": {
                "general.name": os.path.basename(MODEL_PATH),
                "general.architecture": "Неизвестно"
            }
        }

def prepare_prompt(text, system_prompt=None, history=None):
    """Подготовка промпта в правильном формате с поддержкой истории диалога"""
    if system_prompt is None:
        system_prompt = "Ты умный и полезный русскоязычный ассистент. Отвечай подробно и по существу на заданный вопрос. Поддерживай контекст диалога и помни предыдущие сообщения."
    
    # Базовый шаблон для чата
    prompt_parts = [f"<|im_start|>system\n{system_prompt}\n<|im_end|>"]
    
    # Добавляем историю диалога, если она есть
    if history:
        for entry in history:
            role = entry.get("role", "user")
            content = entry.get("content", "")
            if role == "user":
                prompt_parts.append(f"<|im_start|>user\n{content}\n<|im_end|>")
            elif role == "assistant":
                prompt_parts.append(f"<|im_start|>assistant\n{content}\n<|im_end|>")
    
    # Добавляем текущий запрос пользователя
    prompt_parts.append(f"<|im_start|>user\n{text.strip()}\n<|im_end|>")
    prompt_parts.append("<|im_start|>assistant\n")
    
    return "".join(prompt_parts)

def ask_agent(prompt, history=None, max_tokens=None, streaming=False, stream_callback=None):
    if llm is None:
        raise ValueError("Модель не загружена. Пожалуйста, убедитесь, что модель инициализирована.")
    
    # Если не указано количество токенов, берем из настроек
    if max_tokens is None:
        max_tokens = model_settings.get("output_tokens")
    
    # Формируем вход (можно добавить историю позже)
    try:
        # Используем правильный формат запроса
        full_prompt = prepare_prompt(prompt, history=history)
        
        # Если включен режим потоковой генерации
        if streaming and stream_callback:
            # Инициализируем переменную для накопления текста
            accumulated_text = ""
            
            # Создаем генератор для потоковой обработки
            generator = llm(
                full_prompt,
                max_tokens=max_tokens,
                stop=["<|im_end|>", "<|im_start|>"],
                echo=False,
                temperature=model_settings.get("temperature"),
                top_p=model_settings.get("top_p"),
                repeat_penalty=model_settings.get("repeat_penalty"),
                stream=True  # Включаем потоковую генерацию
            )
            
            # Обрабатываем каждый фрагмент
            chunk_counter = 0
            for output in generator:
                chunk = output["choices"][0]["text"]
                accumulated_text += chunk
                chunk_counter += 1
                

                
                # Вызываем колбэк с текущим фрагментом
                stream_callback(chunk, accumulated_text)
            

            
            return accumulated_text
        else:
            # Обычная генерация без стриминга
            output = llm(
                full_prompt,
                max_tokens=max_tokens,     # Размер ответа
                stop=["<|im_end|>", "<|im_start|>"],  # Стоп-токены для формата чата
                echo=False,                # Не возвращать входной текст
                temperature=model_settings.get("temperature"),
                top_p=model_settings.get("top_p"),
                repeat_penalty=model_settings.get("repeat_penalty")
            )
            
            generated_text = output["choices"][0]["text"].strip()
            

            
            # Обрабатываем случай пустого вывода
            if not generated_text:

                # Более безопасные параметры для повторной попытки
                output = llm(
                    prompt.strip(),  # Более простой формат
                    max_tokens=256,  # Уменьшенное число токенов
                    temperature=0.5, # Более низкая температура
                    echo=False
                )
                generated_text = output["choices"][0]["text"].strip()
                

            
            return generated_text
    except Exception as e:

        # Вместо непосредственной передачи ошибки, возвращаем сообщение об ошибке
        return f"Извините, произошла ошибка при генерации ответа: {str(e)}. Попробуйте задать вопрос иначе или позже."
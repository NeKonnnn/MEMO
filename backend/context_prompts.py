"""
Модуль для управления контекстными промптами моделей
Позволяет сохранять, загружать и применять контекстные промпты для каждой модели
"""

import os
import json
from typing import Dict, List, Optional, Any
from pathlib import Path

class ContextPromptManager:
    """Менеджер контекстных промптов для моделей"""
    
    def __init__(self):
        # Путь к файлу с контекстными промптами
        self.prompts_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), "context_prompts.json")
        # Путь к файлу настроек моделей
        self.settings_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend", "settings.json")
        
        # Загружаем существующие промпты
        self.context_prompts = self.load_context_prompts()
    
    def load_context_prompts(self) -> Dict[str, Any]:
        """Загрузка контекстных промптов из файла"""
        try:
            if os.path.exists(self.prompts_file):
                with open(self.prompts_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            else:
                # Создаем файл с базовой структурой
                default_prompts = {
                    "global_prompt": "",
                    "model_prompts": {},
                    "custom_prompts": {}
                }
                self.save_context_prompts(default_prompts)
                return default_prompts
        except Exception as e:
            print(f"Ошибка при загрузке контекстных промптов: {e}")
            return {
                "global_prompt": "",
                "model_prompts": {},
                "custom_prompts": {}
            }
    
    def save_context_prompts(self, prompts: Optional[Dict[str, Any]] = None) -> bool:
        """Сохранение контекстных промптов в файл"""
        try:
            if prompts is None:
                prompts = self.context_prompts
            
            with open(self.prompts_file, 'w', encoding='utf-8') as f:
                json.dump(prompts, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            print(f"Ошибка при сохранении контекстных промптов: {e}")
            return False
    
    def get_global_prompt(self) -> str:
        """Получение глобального промпта"""
        return self.context_prompts.get("global_prompt", "")
    
    def set_global_prompt(self, prompt: str) -> bool:
        """Установка глобального промпта"""
        self.context_prompts["global_prompt"] = prompt
        return self.save_context_prompts()
    
    def get_model_prompt(self, model_path: str) -> str:
        """Получение промпта для конкретной модели"""
        model_prompts = self.context_prompts.get("model_prompts", {})
        return model_prompts.get(model_path, self.get_global_prompt())
    
    def set_model_prompt(self, model_path: str, prompt: str) -> bool:
        """Установка промпта для конкретной модели"""
        if "model_prompts" not in self.context_prompts:
            self.context_prompts["model_prompts"] = {}
        
        self.context_prompts["model_prompts"][model_path] = prompt
        return self.save_context_prompts()
    
    def get_custom_prompt(self, prompt_id: str) -> Optional[str]:
        """Получение пользовательского промпта по ID"""
        custom_prompts = self.context_prompts.get("custom_prompts", {})
        return custom_prompts.get(prompt_id)
    
    def set_custom_prompt(self, prompt_id: str, prompt: str, description: str = "") -> bool:
        """Создание/обновление пользовательского промпта"""
        if "custom_prompts" not in self.context_prompts:
            self.context_prompts["custom_prompts"] = {}
        
        self.context_prompts["custom_prompts"][prompt_id] = {
            "prompt": prompt,
            "description": description,
            "created_at": self._get_current_timestamp()
        }
        return self.save_context_prompts()
    
    def delete_custom_prompt(self, prompt_id: str) -> bool:
        """Удаление пользовательского промпта"""
        if "custom_prompts" in self.context_prompts and prompt_id in self.context_prompts["custom_prompts"]:
            del self.context_prompts["custom_prompts"][prompt_id]
            return self.save_context_prompts()
        return False
    
    def get_all_custom_prompts(self) -> Dict[str, Dict[str, Any]]:
        """Получение всех пользовательских промптов"""
        return self.context_prompts.get("custom_prompts", {})
    
    def get_effective_prompt(self, model_path: str, custom_prompt_id: Optional[str] = None) -> str:
        """Получение эффективного промпта для модели с учетом приоритетов"""
        # 1. Если указан пользовательский промпт, используем его
        if custom_prompt_id:
            custom_prompt = self.get_custom_prompt(custom_prompt_id)
            if custom_prompt:
                return custom_prompt.get("prompt", self.get_global_prompt())
        
        # 2. Если есть промпт для конкретной модели, используем его
        model_prompt = self.get_model_prompt(model_path)
        if model_prompt != self.get_global_prompt():
            return model_prompt
        
        # 3. Иначе используем глобальный промпт
        return self.get_global_prompt()
    
    def get_models_list(self) -> List[Dict[str, Any]]:
        """Получение списка всех моделей с их промптами"""
        try:
            if os.path.exists(self.settings_file):
                with open(self.settings_file, 'r', encoding='utf-8') as f:
                    settings = json.load(f)
                    models = settings.get("models", [])
                    
                    # Добавляем информацию о промптах для каждой модели
                    for model in models:
                        model_path = model.get("path", "")
                        model["context_prompt"] = self.get_model_prompt(model_path)
                        model["has_custom_prompt"] = model_path in self.context_prompts.get("model_prompts", {})
                    
                    return models
            return []
        except Exception as e:
            print(f"Ошибка при получении списка моделей: {e}")
            return []
    
    def _get_current_timestamp(self) -> str:
        """Получение текущей временной метки"""
        from datetime import datetime
        return datetime.now().isoformat()
    
    def export_prompts(self, file_path: str) -> bool:
        """Экспорт всех промптов в файл"""
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(self.context_prompts, f, indent=2, ensure_ascii=False)
            return True
        except Exception as e:
            print(f"Ошибка при экспорте промптов: {e}")
            return False
    
    def import_prompts(self, file_path: str) -> bool:
        """Импорт промптов из файла"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                imported_prompts = json.load(f)
            
            # Валидация структуры
            if not isinstance(imported_prompts, dict):
                return False
            
            # Обновляем промпты
            self.context_prompts.update(imported_prompts)
            return self.save_context_prompts()
        except Exception as e:
            print(f"Ошибка при импорте промптов: {e}")
            return False

# Создаем глобальный экземпляр менеджера
context_prompt_manager = ContextPromptManager()

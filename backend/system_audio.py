import os
import tempfile
import time
import wave
import numpy as np
import threading
import platform
import pyaudio
import sounddevice as sd
import soundfile as sf
from comtypes import CLSCTX_ALL
from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

class SystemAudioRecorder:
    """Класс для записи системного звука (включая голос собеседника) и микрофона"""
    
    def __init__(self, sample_rate=16000, channels=1):
        self.sample_rate = sample_rate
        self.channels = channels
        self.temp_dir = tempfile.mkdtemp()
        self.recording = False
        self.is_windows = platform.system() == 'Windows'
        self.recording_thread = None
        self.audio_data = None
        self.system_audio_device = None
        self.mic_audio_device = None
    
    def list_audio_devices(self):
        """Получает список всех доступных аудиоустройств"""
        p = pyaudio.PyAudio()
        devices = []
        
        # Перебираем все устройства
        info = "\nДоступные аудиоустройства:\n"
        for i in range(p.get_device_count()):
            dev_info = p.get_device_info_by_index(i)
            name = dev_info.get('name')
            max_input_channels = dev_info.get('maxInputChannels')
            max_output_channels = dev_info.get('maxOutputChannels')
            
            device_type = []
            if max_input_channels > 0:
                device_type.append("input")
            if max_output_channels > 0:
                device_type.append("output")
                
            device_type_str = ", ".join(device_type)
            info += f"[{i}] {name} ({device_type_str})\n"
            
            devices.append({
                'index': i,
                'name': name,
                'input_channels': max_input_channels,
                'output_channels': max_output_channels,
                'type': device_type
            })
        
        # Ищем устройство для системного звука
        system_device = None
        if self.is_windows:
            # В Windows ищем устройства с названиями, которые обычно используются для системного звука
            system_keywords = ['stereo mix', 'what u hear', 'wasapi', 'loopback', 'мониторинг']
            for device in devices:
                # Преобразуем название в нижний регистр для удобства поиска
                name_lower = device['name'].lower()
                if any(keyword in name_lower for keyword in system_keywords) and 'input' in device['type']:
                    system_device = device
                    break
        
        # Определяем устройство по умолчанию для микрофона
        default_mic = None
        for device in devices:
            if device['input_channels'] > 0:
                # Берем первое устройство с входными каналами (микрофон)
                default_mic = device
                break
        
        p.terminate()
        
        # Выводим информацию о рекомендуемых устройствах
        if system_device:
            info += f"\nРекомендуемое устройство для системного звука: [{system_device['index']}] {system_device['name']}\n"
        else:
            info += "\nНе найдено подходящее устройство для системного звука.\n"
            info += "Вам может потребоваться включить 'Стерео микшер' в настройках звука Windows.\n"
        
        if default_mic:
            info += f"Микрофон по умолчанию: [{default_mic['index']}] {default_mic['name']}\n"
        

        
        return {
            'all_devices': devices,
            'system_device': system_device,
            'default_mic': default_mic
        }
    
    def enable_stereo_mix(self):
        """Пытается включить стерео микшер на Windows"""
        if not self.is_windows:
            print("Эта функция доступна только для Windows.")
            return False
        
        try:
            devices = AudioUtilities.GetSpeakers()
            interface = devices.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
            volume = interface.QueryInterface(IAudioEndpointVolume)
            
            # Проверяем, есть ли Stereo Mix
            # Примечание: это упрощенная версия, которая может не работать на всех системах
            p = pyaudio.PyAudio()
            found = False
            
            for i in range(p.get_device_count()):
                dev = p.get_device_info_by_index(i)
                if 'stereo mix' in dev['name'].lower() and dev['maxInputChannels'] > 0:
                    found = True
                    print(f"Найден Stereo Mix: {dev['name']}")
                    break
            
            p.terminate()
            
            if not found:
                print("Stereo Mix не найден или отключен в вашей системе.")
                print("Инструкция для включения:")
                print("1. Правый клик на значок звука -> Звуки")
                print("2. Вкладка 'Запись'")
                print("3. Правый клик в пустом месте -> 'Показать отключенные устройства'")
                print("4. Правый клик на 'Стерео микшер' -> 'Включить'")
                return False
            
            return True
        except Exception as e:
            print(f"Ошибка при активации Stereo Mix: {e}")
            return False
    
    def start_recording(self, system_device_index=None, mic_device_index=None, duration=None):
        """Запускает запись системного звука и микрофона"""
        if self.recording:
            print("Запись уже идет")
            return False
        
        try:
            # Если устройства не указаны, пытаемся найти их автоматически
            if system_device_index is None or mic_device_index is None:
                devices = self.list_audio_devices()
                
                if system_device_index is None and devices['system_device']:
                    system_device_index = devices['system_device']['index']
                
                if mic_device_index is None and devices['default_mic']:
                    mic_device_index = devices['default_mic']['index']
            
            # Проверяем, что нашли устройства
            if system_device_index is None:
                print("Предупреждение: Не указано устройство для системного звука. Будет записан только микрофон.")
            
            if mic_device_index is None:
                print("Ошибка: Не найден микрофон для записи.")
                return False
            
            self.system_audio_device = system_device_index
            self.mic_audio_device = mic_device_index
            
            # Запускаем запись в отдельном потоке
            self.recording = True
            self.recording_thread = threading.Thread(target=self._record_audio, args=(duration,))
            self.recording_thread.daemon = True
            self.recording_thread.start()
            
            print(f"Запись начата. Используется микрофон #{mic_device_index}" + 
                  (f" и системный звук #{system_device_index}" if system_device_index is not None else ""))
            
            return True
        except Exception as e:
            print(f"Ошибка при запуске записи: {e}")
            self.recording = False
            return False
    
    def stop_recording(self):
        """Останавливает запись и возвращает путь к записанному файлу"""
        if not self.recording:
            print("Запись не была запущена")
            return None
        
        self.recording = False
        
        # Ждем завершения потока записи
        if self.recording_thread and self.recording_thread.is_alive():
            self.recording_thread.join(2)  # Ждем максимум 2 секунды
        
        # Сохраняем записанные данные
        output_path = self._save_recording()
        print(f"Запись остановлена и сохранена в: {output_path}")
        
        return output_path
    
    def _record_audio(self, duration=None):
        """Внутренний метод для записи аудио"""
        try:
            p = pyaudio.PyAudio()
            
            # Открываем поток для микрофона
            mic_stream = p.open(
                format=pyaudio.paInt16,
                channels=self.channels,
                rate=self.sample_rate,
                input=True,
                frames_per_buffer=1024,
                input_device_index=self.mic_audio_device
            )
            
            # Открываем поток для системного звука, если он доступен
            system_stream = None
            if self.system_audio_device is not None:
                try:
                    system_stream = p.open(
                        format=pyaudio.paInt16,
                        channels=self.channels,
                        rate=self.sample_rate,
                        input=True,
                        frames_per_buffer=1024,
                        input_device_index=self.system_audio_device
                    )
                except Exception as e:
                    print(f"Не удалось открыть системный звук: {e}")
            
            # Буферы для хранения данных
            mic_frames = []
            system_frames = []
            
            start_time = time.time()
            
            # Записываем до тех пор, пока не установлен self.recording = False
            # или не истечет duration (если задан)
            print("Идет запись...")
            
            while self.recording:
                # Проверяем, не истекло ли время записи
                if duration and (time.time() - start_time) > duration:
                    self.recording = False
                    break
                
                # Читаем данные с микрофона
                mic_data = mic_stream.read(1024, exception_on_overflow=False)
                mic_frames.append(mic_data)
                
                # Читаем данные с системного звука, если он доступен
                if system_stream:
                    system_data = system_stream.read(1024, exception_on_overflow=False)
                    system_frames.append(system_data)
            
            # Закрываем потоки
            mic_stream.stop_stream()
            mic_stream.close()
            
            if system_stream:
                system_stream.stop_stream()
                system_stream.close()
            
            p.terminate()
            
            # Сохраняем данные для последующей обработки
            self.audio_data = {
                'mic': mic_frames,
                'system': system_frames if system_stream else None
            }
            
        except Exception as e:
            print(f"Ошибка при записи: {e}")
            self.recording = False
    
    def _save_recording(self):
        """Сохраняет записанные данные в файл с миксованием микрофона и системного звука"""
        if not self.audio_data:
            print("Нет данных для сохранения")
            return None
        
        try:
            # Создаем имя выходного файла
            output_file = os.path.join(self.temp_dir, f"meeting_recording_{int(time.time())}.wav")
            
            # Проверяем наличие данных системного звука
            if self.audio_data['system']:
                # Если есть системный звук, смешиваем его с микрофоном
                # Преобразуем байтовые данные в numpy массивы
                mic_data = np.frombuffer(b''.join(self.audio_data['mic']), dtype=np.int16)
                system_data = np.frombuffer(b''.join(self.audio_data['system']), dtype=np.int16)
                
                # Обрезаем массивы до одинаковой длины
                min_length = min(len(mic_data), len(system_data))
                mic_data = mic_data[:min_length]
                system_data = system_data[:min_length]
                
                # Смешиваем микрофон и системный звук (50/50)
                # Микшируем, избегая переполнения
                mixed_data = np.clip(mic_data + system_data, -32768, 32767).astype(np.int16)
                
                # Сохраняем микшированные данные в файл
                with wave.open(output_file, 'wb') as wf:
                    wf.setnchannels(self.channels)
                    wf.setsampwidth(2)  # 16 бит = 2 байта
                    wf.setframerate(self.sample_rate)
                    wf.writeframes(mixed_data.tobytes())
            else:
                # Если нет системного звука, сохраняем только микрофон
                with wave.open(output_file, 'wb') as wf:
                    wf.setnchannels(self.channels)
                    wf.setsampwidth(2)  # 16 бит = 2 байта
                    wf.setframerate(self.sample_rate)
                    wf.writeframes(b''.join(self.audio_data['mic']))
            
            # Очищаем данные после сохранения
            self.audio_data = None
            
            return output_file
            
        except Exception as e:
            print(f"Ошибка при сохранении записи: {e}")
            return None
    
    def check_windows_stereo_mix(self):
        """Проверяет доступность Stereo Mix на Windows и дает рекомендации"""
        if not self.is_windows:
            return "Не Windows"
        
        devices = self.list_audio_devices()
        stereo_mix_found = False
        
        for device in devices['all_devices']:
            if ('stereo mix' in device['name'].lower() or 'стерео микшер' in device['name'].lower()) and device['input_channels'] > 0:
                stereo_mix_found = True
                return f"Stereo Mix найден: [{device['index']}] {device['name']}"
        
        if not stereo_mix_found:
            return """
Stereo Mix не найден или отключен. Инструкции по включению:
1. Правый клик на значок звука в трее -> Звуки
2. Перейдите на вкладку 'Запись'
3. Правый клик в пустом месте -> 'Показать отключенные устройства'
4. Найдите 'Стерео микшер', правый клик -> 'Включить'
5. Если устройство не появилось, возможно, ваша звуковая карта не поддерживает эту функцию
6. Альтернатива: установите VB-Cable (https://vb-audio.com/Cable/)
"""
        
        return "Неизвестная ошибка при проверке Stereo Mix" 
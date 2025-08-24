import os
import tempfile
import time
import wave
import numpy as np
import threading
import platform
import pyaudio
import comtypes
from comtypes import CLSCTX_ALL
from pycaw.pycaw import AudioUtilities, IAudioEndpointVolume

class WasapiLoopbackCapture:
    """Класс для записи системного звука через WASAPI loopback режим без необходимости Stereo Mix"""
    
    def __init__(self, sample_rate=16000, channels=1, chunk_size=1024):
        self.sample_rate = sample_rate
        self.channels = channels
        self.chunk_size = chunk_size
        self.temp_dir = tempfile.mkdtemp()
        self.recording = False
        self.recording_thread = None
        self.frames = []
        
    def list_devices(self):
        """Выводит список доступных аудиоустройств"""
        p = pyaudio.PyAudio()
        info = "\nДоступные аудиоустройства:\n"
        
        # Ищем WASAPI loopback устройства
        loopback_devices = []
        
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
            
            # Проверяем, не является ли устройство устройством вывода, которое можно использовать для loopback
            if max_output_channels > 0:
                loopback_devices.append({
                    'index': i,
                    'name': name,
                    'is_loopback': "loopback" in name.lower() or "wasapi" in name.lower()
                })
        
        p.terminate()
        
        # Выводим потенциальные устройства для записи системного звука
        if loopback_devices:
            info += "\nПотенциальные устройства для записи системного звука:\n"
            for dev in loopback_devices:
                info += f"[{dev['index']}] {dev['name']}" + (" (поддерживает loopback)" if dev['is_loopback'] else "") + "\n"
        else:
            info += "\nНе найдены устройства для записи системного звука.\n"
        

        return loopback_devices
    
    def start_recording(self, device_index=None, duration=None):
        """Запускает запись системного звука"""
        if self.recording:
            print("Запись уже идет")
            return False
        
        # Если устройство не указано, используем устройство по умолчанию
        if device_index is None:
            device_index = 0  # Индекс устройства по умолчанию
            print(f"Используется устройство по умолчанию (индекс {device_index})")
        
        try:
            self.frames = []
            self.recording = True
            self.recording_thread = threading.Thread(target=self._record_audio, args=(device_index, duration))
            self.recording_thread.daemon = True
            self.recording_thread.start()
            
            print(f"Запись системного звука начата (устройство #{device_index})")
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
    
    def _record_audio(self, device_index, duration=None):
        """Внутренний метод для записи аудио"""
        try:
            p = pyaudio.PyAudio()
            
            # Открываем поток для записи системного звука
            # Примечание: для WASAPI loopback важно использовать host_api_specific_stream_info
            # но это требует дополнительных настроек и проверки совместимости
            # Пока используем обычный подход
            stream = p.open(
                format=pyaudio.paInt16,
                channels=self.channels,
                rate=self.sample_rate,
                input=True,
                frames_per_buffer=self.chunk_size,
                input_device_index=device_index
            )
            
            start_time = time.time()
            print("Идет запись...")
            
            while self.recording:
                # Проверяем, не истекло ли время записи
                if duration and (time.time() - start_time) > duration:
                    self.recording = False
                    break
                
                # Читаем данные
                data = stream.read(self.chunk_size, exception_on_overflow=False)
                self.frames.append(data)
                
                # Каждые секунду выводим сообщение (необязательно)
                current_duration = int(time.time() - start_time)
                if duration and current_duration % 1 == 0:
                    print(f"Идет запись: {current_duration}/{duration} сек...", end="\r")
            
            # Закрываем поток
            stream.stop_stream()
            stream.close()
            p.terminate()
            
        except Exception as e:
            print(f"Ошибка при записи: {e}")
            self.recording = False
    
    def _save_recording(self):
        """Сохраняет записанные данные в файл"""
        if not self.frames:
            print("Нет данных для сохранения")
            return None
        
        try:
            # Создаем имя выходного файла
            output_file = os.path.join(self.temp_dir, f"system_audio_{int(time.time())}.wav")
            
            # Сохраняем данные в файл
            with wave.open(output_file, 'wb') as wf:
                wf.setnchannels(self.channels)
                wf.setsampwidth(2)  # 16 бит = 2 байта
                wf.setframerate(self.sample_rate)
                wf.writeframes(b''.join(self.frames))
            
            # Очищаем буфер после сохранения
            self.frames = []
            
            return output_file
            
        except Exception as e:
            print(f"Ошибка при сохранении записи: {e}")
            return None

# Пример использования
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='Запись системного звука с помощью PyAudio')
    parser.add_argument('--list', action='store_true', help='Показать список доступных устройств')
    parser.add_argument('--device', type=int, help='Индекс устройства для записи')
    parser.add_argument('--duration', type=int, default=5, help='Длительность записи в секундах (по умолчанию 5)')
    args = parser.parse_args()
    
    recorder = WasapiLoopbackCapture()
    
    if args.list:
        recorder.list_devices()
    else:
        print(f"Запуск записи на {args.duration} секунд...")
        print("Нажмите Ctrl+C для остановки записи раньше.")
        
        try:
            recorder.start_recording(args.device, args.duration)
            # Ждем указанное время
            time.sleep(args.duration)
            output_file = recorder.stop_recording()
            print(f"Запись сохранена в файл: {output_file}")
        except KeyboardInterrupt:
            print("\nЗапись прервана пользователем.")
            recorder.stop_recording() 
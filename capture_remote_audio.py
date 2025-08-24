import os
import sys
import time
import argparse
from .system_audio_capture import WasapiLoopbackCapture
from .transcriber import Transcriber

def main():
    parser = argparse.ArgumentParser(description="Запись и транскрибация звука собеседника из удаленных встреч/звонков")
    parser.add_argument("--list", action="store_true", help="Показать список доступных устройств")
    parser.add_argument("--device", type=int, help="Индекс устройства вывода звука для перехвата в loopback")
    parser.add_argument("--duration", type=int, default=30, help="Длительность записи в секундах (по умолчанию 30)")
    parser.add_argument("--output", type=str, help="Путь для сохранения аудиофайла (по умолчанию временный файл)")
    args = parser.parse_args()
    
    # Создаем объекты для работы с аудио и транскрибацией
    recorder = WasapiLoopbackCapture()
    transcriber = Transcriber()
    
    # Если нужно показать список устройств
    if args.list:
        recorder.list_devices()
        return
    
    # Выбираем устройство для записи
    device_index = args.device
    if device_index is None:
        # Пытаемся найти устройство Speakers или Headphones
        output_devices = []
        p = pyaudio.PyAudio()
        for i in range(p.get_device_count()):
            dev_info = p.get_device_info_by_index(i)
            if dev_info.get('maxOutputChannels', 0) > 0:
                name = dev_info.get('name', '').lower()
                if "speaker" in name or "headphone" in name or "динамик" in name or "наушники" in name:
                    output_devices.append((i, dev_info.get('name')))
        p.terminate()
        
        if output_devices:
            print("Найдены устройства вывода звука:")
            for idx, (i, name) in enumerate(output_devices):
                print(f"[{idx}] {name} (индекс: {i})")
            
            choice = input("Выберите номер устройства (или нажмите Enter для использования первого): ")
            if choice.strip():
                try:
                    selected = int(choice)
                    if 0 <= selected < len(output_devices):
                        device_index = output_devices[selected][0]
                    else:
                        print("Неверный номер. Используется первое устройство.")
                        device_index = output_devices[0][0]
                except ValueError:
                    print("Неверный ввод. Используется первое устройство.")
                    device_index = output_devices[0][0]
            else:
                device_index = output_devices[0][0]
                
            print(f"Выбрано устройство: {output_devices[0][1]} (индекс: {device_index})")
        else:
            print("Не найдены устройства вывода звука. Используется устройство по умолчанию (индекс 0).")
            device_index = 0
    
    print("\nИнструкция по использованию:")
    print("1. Убедитесь, что звук с собеседника идет через выбранное устройство")
    print("2. Рекомендуется использовать наушники, чтобы микрофон не записывал звук из динамиков")
    print("3. Во время записи говорите в микрофон как обычно\n")
    
    # Запускаем запись
    print(f"Начинаем запись на {args.duration} секунд...")
    print("Нажмите Ctrl+C чтобы остановить запись раньше времени")
    
    try:
        # Запускаем запись
        success = recorder.start_recording(device_index, args.duration)
        if not success:
            print("Не удалось запустить запись. Проверьте выбранное устройство.")
            return
        
        # Ждем указанное время, показывая прогресс
        for i in range(args.duration):
            time.sleep(1)
            sys.stdout.write(f"\rЗапись: {i+1}/{args.duration} сек")
            sys.stdout.flush()
        
        print("\nЗавершение записи...")
        audio_file = recorder.stop_recording()
        
        if not audio_file:
            print("Ошибка при записи аудио.")
            return
        
        # Сохраняем в указанный путь, если он задан
        if args.output:
            import shutil
            shutil.copy(audio_file, args.output)
            print(f"Аудиозапись сохранена в: {args.output}")
            audio_file = args.output
        
        # Транскрибируем аудио
        print("\nНачинаем транскрибацию...")
        transcript = transcriber.transcribe_audio_file(audio_file)
        
        print("\nТранскрибация завершена:")
        print("-" * 40)
        print(transcript)
        print("-" * 40)
        
        # Сохраняем транскрибацию
        transcript_file = os.path.splitext(audio_file)[0] + ".txt"
        with open(transcript_file, "w", encoding="utf-8") as f:
            f.write(transcript)
        
        print(f"\nТранскрипция сохранена в: {transcript_file}")
        
    except KeyboardInterrupt:
        print("\nЗапись прервана пользователем.")
        audio_file = recorder.stop_recording()
        
        if audio_file:
            print(f"Аудиозапись сохранена в: {audio_file}")
            
            # Транскрибируем аудио
            print("\nНачинаем транскрибацию...")
            transcript = transcriber.transcribe_audio_file(audio_file)
            
            print("\nТранскрибация завершена:")
            print("-" * 40)
            print(transcript)
            print("-" * 40)
            
            # Сохраняем транскрибацию
            transcript_file = os.path.splitext(audio_file)[0] + ".txt"
            with open(transcript_file, "w", encoding="utf-8") as f:
                f.write(transcript)
            
            print(f"\nТранскрипция сохранена в: {transcript_file}")
    
    print("\nРабота завершена.")

if __name__ == "__main__":
    import pyaudio  # Импортируем здесь для удобства
    main() 
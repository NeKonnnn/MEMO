import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';

interface VoiceIndicatorProps {
  isRecording: boolean;
  stream?: MediaStream | null;
}

function VoiceIndicator({ isRecording, stream }: VoiceIndicatorProps) {
  const [levels, setLevels] = useState([0, 0, 0, 0, 0, 0, 0]); // 7 столбиков для красоты
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Запуск анализа звука
  const startAnalyzing = async () => {
    if (!stream) return;

    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      
      analyser.fftSize = 64; // Оптимальный размер для 7 столбиков
      analyser.smoothingTimeConstant = 0.8; // Плавность анимации

      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      analyserRef.current = analyser;
      dataArrayRef.current = dataArray;
      audioContextRef.current = audioContext;

      // Анимация в реальном времени
      const animate = () => {
        if (!analyserRef.current || !dataArrayRef.current) return;

        analyserRef.current.getByteFrequencyData(dataArrayRef.current);

        // Суммируем уровни по частотам для каждого столбика
        const step = Math.floor(bufferLength / 7);
        const newLevels = [
          average(dataArrayRef.current.slice(0, step)),
          average(dataArrayRef.current.slice(step, step * 2)),
          average(dataArrayRef.current.slice(step * 2, step * 3)),
          average(dataArrayRef.current.slice(step * 3, step * 4)),
          average(dataArrayRef.current.slice(step * 4, step * 5)),
          average(dataArrayRef.current.slice(step * 5, step * 6)),
          average(dataArrayRef.current.slice(step * 6, bufferLength))
        ];

        // Нормализуем: от 0 до 100 с плавностью
        const maxLevel = Math.max(...newLevels);
        if (maxLevel > 0) {
          setLevels(newLevels.map(l => Math.min((l / maxLevel) * 100, 100)));
        }

        animationRef.current = requestAnimationFrame(animate);
      };

      animate();
    } catch (err) {
      console.error('Ошибка анализа звука:', err);
    }
  };

  // Остановка анализа
  const stopAnalyzing = () => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setLevels([0, 0, 0, 0, 0, 0, 0]);
  };

  // Функция для среднего значения массива
  function average(arr: Uint8Array): number {
    return arr.reduce((sum, val) => sum + val, 0) / arr.length;
  }

  // Эффект для управления анализом
  useEffect(() => {
    if (isRecording && stream) {
      startAnalyzing();
    } else {
      stopAnalyzing();
    }

    return () => {
      stopAnalyzing();
    };
  }, [isRecording, stream]);

  if (!isRecording) return null;

  return (
    <Box sx={{ 
      textAlign: 'center', 
      py: 2,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 2
    }}>
      <Typography variant="body2" color="primary.main" sx={{ fontWeight: 500 }}>
        Уровень голоса
      </Typography>
      
      <Box sx={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'flex-end',
        gap: 1,
        height: 80,
        width: '100%',
        maxWidth: 200
      }}>
        {levels.map((level, i) => {
          // Вычисляем задержку анимации: начинаем с центра (индекс 3) и идем в обе стороны
          const centerIndex = 3; // Центральный столбик
          const distanceFromCenter = Math.abs(i - centerIndex);
          const animationDelay = distanceFromCenter * 0.1; // Задержка зависит от расстояния от центра
          
          return (
            <Box
              key={i}
              sx={{
                width: 6,
                height: Math.max(level * 0.6, 4), // Минимальная высота 4px
                background: 'linear-gradient(180deg, #1976d2 0%, #42a5f5 50%, #90caf9 100%)',
                borderRadius: 3,
                transition: 'height 0.1s ease-out, opacity 0.1s ease-out',
                boxShadow: '0 0 8px rgba(25, 118, 210, 0.6)',
                opacity: level > 10 ? 1 : 0.4,
                minHeight: 4,
                animation: 'waveFromCenter 1.2s infinite ease-in-out',
                animationDelay: `${animationDelay}s`,
                '@keyframes waveFromCenter': {
                  '0%': { 
                    transform: 'scaleY(0.3)',
                    opacity: 0.4
                  },
                  '25%': { 
                    transform: 'scaleY(0.6)',
                    opacity: 0.7
                  },
                  '50%': { 
                    transform: 'scaleY(1)',
                    opacity: 1
                  },
                  '75%': { 
                    transform: 'scaleY(0.6)',
                    opacity: 0.7
                  },
                  '100%': { 
                    transform: 'scaleY(0.3)',
                    opacity: 0.4
                  },
                },
              }}
            />
          );
        })}
      </Box>
    </Box>
  );
}

export default VoiceIndicator;

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, FormControlLabel, Switch, Typography } from '@mui/material';
import { ImageOutlined as ImageIcon } from '@mui/icons-material';
import { CHAT_GEAR_SCROLL_AREA_NO_VISIBLE_SCROLLBAR_SX, MENU_ACTION_TEXT_SIZE } from '../constants/menuStyles';
import {
  isImageGenerationModeEnabled,
  setImageGenerationModeEnabled,
} from '../imageGeneration/selectionStorage';
import { setCodingModeEnabled } from '../coding/selectionStorage';
import { readSelectedImageGenPresetId } from '../utils/imageGenerationPresets';

interface ChatGearImageGenPanelProps {
  isDarkMode: boolean;
  chatId: string | null | undefined;
}

export default function ChatGearImageGenPanel({ isDarkMode, chatId }: ChatGearImageGenPanelProps) {
  const muted = isDarkMode ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.6)';
  const text = isDarkMode ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.9)';

  const [modeOn, setModeOn] = useState(() => isImageGenerationModeEnabled(chatId));
  const [presetId, setPresetId] = useState(() => readSelectedImageGenPresetId() || '');

  useEffect(() => {
    setModeOn(isImageGenerationModeEnabled(chatId));
  }, [chatId]);

  useEffect(() => {
    const syncMode = () => setModeOn(isImageGenerationModeEnabled(chatId));
    const syncPreset = () => setPresetId(readSelectedImageGenPresetId() || '');
    window.addEventListener('astrachatImageGenModeChanged', syncMode);
    window.addEventListener('astrachatImageGenPresetChanged', syncPreset);
    return () => {
      window.removeEventListener('astrachatImageGenModeChanged', syncMode);
      window.removeEventListener('astrachatImageGenPresetChanged', syncPreset);
    };
  }, [chatId]);

  const toggleMode = useCallback(
    (_: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {
      setModeOn(checked);
      setImageGenerationModeEnabled(chatId, checked);
      if (checked) {
        setCodingModeEnabled(chatId, false);
        window.dispatchEvent(new CustomEvent('astrachatCodingSelectionChanged'));
      }
      window.dispatchEvent(new CustomEvent('astrachatImageGenModeChanged'));
    },
    [chatId],
  );

  if (!chatId) {
    return (
      <Box sx={{ p: 2, color: muted, fontSize: MENU_ACTION_TEXT_SIZE }}>
        Откройте чат, чтобы включить режим генерации изображений.
      </Box>
    );
  }

  return (
    <Box
      sx={{
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        overflowY: 'auto',
        ...CHAT_GEAR_SCROLL_AREA_NO_VISIBLE_SCROLLBAR_SX,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <ImageIcon sx={{ fontSize: 20, color: muted }} />
        <Typography sx={{ fontWeight: 600, fontSize: MENU_ACTION_TEXT_SIZE, color: text }}>
          Режим генерации
        </Typography>
      </Box>

      <FormControlLabel
        control={<Switch checked={modeOn} onChange={toggleMode} color="primary" />}
        label={
          <Typography sx={{ fontSize: MENU_ACTION_TEXT_SIZE, color: text }}>
            Генерировать изображения из сообщений
          </Typography>
        }
      />

      <Alert severity="info" sx={{ fontSize: '0.78rem', py: 0.5 }}>
        Когда режим включён, текст вашего сообщения целиком уходит как промпт в ComfyUI.
        Фразы вроде «нарисуй» или «сгенерируй» сами по себе генерацию не запускают.
      </Alert>

      {modeOn ? (
        <Typography sx={{ fontSize: '0.75rem', color: muted }}>
          Пресет: {presetId || 'по умолчанию'} — смените в «Агенты / Модели → Изображения».
        </Typography>
      ) : null}
    </Box>
  );
}

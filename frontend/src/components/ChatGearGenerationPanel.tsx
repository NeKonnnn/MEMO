import React, { useCallback, useEffect, useState } from 'react';

import { Alert, Box, FormControlLabel, Switch, Typography } from '@mui/material';

import { ImageOutlined as ImageIcon, VideocamOutlined as VideoIcon } from '@mui/icons-material';

import { CHAT_GEAR_SCROLL_AREA_NO_VISIBLE_SCROLLBAR_SX, MENU_ACTION_TEXT_SIZE } from '../constants/menuStyles';

import {

  isImageGenerationModeEnabled,

  isVideoGenerationModeEnabled,

  setImageGenerationModeEnabled,

  setVideoGenerationModeEnabled,

  dispatchGenerationModeChanged,

} from '../imageGeneration/selectionStorage';

import { setCodingModeEnabled } from '../coding/selectionStorage';

import { readSelectedImageGenPresetId } from '../utils/imageGenerationPresets';



interface ChatGearGenerationPanelProps {

  isDarkMode: boolean;

  chatId: string | null | undefined;

}



export default function ChatGearGenerationPanel({ isDarkMode, chatId }: ChatGearGenerationPanelProps) {

  const muted = isDarkMode ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.6)';

  const text = isDarkMode ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.9)';



  const [imageOn, setImageOn] = useState(() => isImageGenerationModeEnabled(chatId));

  const [videoOn, setVideoOn] = useState(() => isVideoGenerationModeEnabled(chatId));

  const [presetId, setPresetId] = useState(() => readSelectedImageGenPresetId() || '');



  useEffect(() => {

    setImageOn(isImageGenerationModeEnabled(chatId));

    setVideoOn(isVideoGenerationModeEnabled(chatId));

  }, [chatId]);



  useEffect(() => {

    const sync = () => {

      setImageOn(isImageGenerationModeEnabled(chatId));

      setVideoOn(isVideoGenerationModeEnabled(chatId));

    };

    const syncPreset = () => setPresetId(readSelectedImageGenPresetId() || '');

    window.addEventListener('astrachatGenerationModeChanged', sync);

    window.addEventListener('astrachatImageGenPresetChanged', syncPreset);

    return () => {

      window.removeEventListener('astrachatGenerationModeChanged', sync);

      window.removeEventListener('astrachatImageGenPresetChanged', syncPreset);

    };

  }, [chatId]);



  const disableCodingIfNeeded = useCallback(() => {

    setCodingModeEnabled(chatId, false);

    window.dispatchEvent(new CustomEvent('astrachatCodingSelectionChanged'));

  }, [chatId]);



  const toggleImage = useCallback(

    (_: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {

      setImageOn(checked);

      setImageGenerationModeEnabled(chatId, checked);

      if (checked) {

        setVideoOn(false);

        setVideoGenerationModeEnabled(chatId, false);

        disableCodingIfNeeded();

      }

      dispatchGenerationModeChanged();

    },

    [chatId, disableCodingIfNeeded],

  );



  const toggleVideo = useCallback(

    (_: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {

      setVideoOn(checked);

      setVideoGenerationModeEnabled(chatId, checked);

      if (checked) {

        setImageOn(false);

        setImageGenerationModeEnabled(chatId, false);

        disableCodingIfNeeded();

      }

      dispatchGenerationModeChanged();

    },

    [chatId, disableCodingIfNeeded],

  );



  if (!chatId) {

    return (

      <Box sx={{ p: 2, color: muted, fontSize: MENU_ACTION_TEXT_SIZE }}>

        Откройте чат, чтобы включить режим генерации.

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

      <Typography sx={{ fontWeight: 600, fontSize: MENU_ACTION_TEXT_SIZE, color: text }}>

        Режим генерации

      </Typography>



      <FormControlLabel

        control={<Switch checked={imageOn} onChange={toggleImage} color="primary" />}

        label={

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>

            <ImageIcon sx={{ fontSize: 18, color: muted }} />

            <Typography sx={{ fontSize: MENU_ACTION_TEXT_SIZE, color: text }}>

              Генерация изображений

            </Typography>

          </Box>

        }

      />



      <FormControlLabel

        control={<Switch checked={videoOn} onChange={toggleVideo} color="primary" />}

        label={

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>

            <VideoIcon sx={{ fontSize: 18, color: muted }} />

            <Typography sx={{ fontSize: MENU_ACTION_TEXT_SIZE, color: text }}>

              Генерация видео

            </Typography>

          </Box>

        }

      />



      <Alert severity="info" sx={{ fontSize: '0.78rem', py: 0.5 }}>

        Когда режим включён, текст сообщения целиком уходит как промпт в ComfyUI. Одновременно активен

        только один тип генерации.

      </Alert>



      {imageOn ? (

        <Typography sx={{ fontSize: '0.75rem', color: muted }}>

          Пресет изображений: {presetId || 'по умолчанию'} — смените в «Агенты / Модели → Изображения».

        </Typography>

      ) : null}



      {videoOn ? (

        <Typography sx={{ fontSize: '0.75rem', color: muted }}>

          Видео: настройте workflow в <code>video_generation</code> в config.yml (ComfyUI).

        </Typography>

      ) : null}

    </Box>

  );

}



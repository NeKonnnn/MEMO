import React from 'react';
import { Box, TextField, Tooltip, Typography } from '@mui/material';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import type { SxProps, Theme } from '@mui/material/styles';

interface MaxAgentStepsFieldProps {
  value: number | '';
  onChange: (value: number | '') => void;
  defaultSteps: number;
  maxSteps: number;
  readOnly?: boolean;
  panelChrome: {
    fgSubtle: string;
    fgMuted: string;
  };
  categoryFieldSx?: SxProps<Theme>;
}

export default function MaxAgentStepsField({
  value,
  onChange,
  defaultSteps,
  maxSteps,
  readOnly = false,
  panelChrome,
  categoryFieldSx,
}: MaxAgentStepsFieldProps) {
  return (
    <Box sx={{ minWidth: 0, mt: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75 }}>
        <Typography
          variant="caption"
          sx={{
            color: 'inherit',
            opacity: 0.65,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            fontSize: '0.7rem',
          }}
        >
          Максимальное количество шагов агента
        </Typography>
        <Tooltip
          title={`Ограничивает шаги за один запуск (LLM-запрос или раунд инструментов). Пусто — глобальный лимит (${defaultSteps}). Максимум ${maxSteps}.`}
          arrow
        >
          <HelpOutlineIcon sx={{ fontSize: 13, color: panelChrome.fgSubtle, cursor: 'help' }} />
        </Tooltip>
      </Box>
      <TextField
        fullWidth
        size="small"
        type="number"
        disabled={readOnly}
        value={value}
        placeholder={`По умолчанию: ${defaultSteps}`}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange('');
            return;
          }
          const n = Number(raw);
          if (!Number.isFinite(n)) return;
          onChange(Math.max(1, Math.min(Math.trunc(n), maxSteps)));
        }}
        inputProps={{ min: 1, max: maxSteps, step: 1 }}
        sx={categoryFieldSx}
      />
    </Box>
  );
}

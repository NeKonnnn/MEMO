import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import {
  fetchCodingWorkspaces,
  validateCodingWorkspace,
  type WorkspacePreset,
} from '../coding/api';
import { getGlobalDefaultWorkspace, setGlobalDefaultWorkspace } from '../coding/workspaceStorage';

const CUSTOM_ID = '__custom__';

interface WorkspacePickerProps {
  value: string;
  onChange: (path: string) => void;
  disabled?: boolean;
  isDarkMode?: boolean;
  showGlobalDefault?: boolean;
  compact?: boolean;
}

export default function WorkspacePicker({
  value,
  onChange,
  disabled = false,
  isDarkMode = false,
  showGlobalDefault = true,
  compact = false,
}: WorkspacePickerProps) {
  const muted = isDarkMode ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.6)';
  const text = isDarkMode ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.9)';

  const [presets, setPresets] = useState<WorkspacePreset[]>([]);
  const [serverDefault, setServerDefault] = useState('');
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const [validationOk, setValidationOk] = useState<boolean | null>(null);
  const [useCustomPath, setUseCustomPath] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchCodingWorkspaces()
      .then((data) => {
        if (cancelled) return;
        const loaded = data.presets || [];
        setPresets(loaded);
        setServerDefault(data.default_workspace || '');
        const current = value.trim();
        if (current) {
          const matchesPreset = loaded.some(
            (p) => p.path === current || p.path.replace(/\\/g, '/') === current.replace(/\\/g, '/'),
          );
          setUseCustomPath(!matchesPreset);
        } else {
          const pick =
            data.default_workspace ||
            loaded.find((p) => p.ok)?.path ||
            loaded[0]?.path ||
            '';
          if (pick) onChange(pick);
        }
      })
      .catch(() => {
        if (!cancelled) setPresets([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- init once

  const selectedId = useMemo(() => {
    if (useCustomPath) return CUSTOM_ID;
    const v = value.trim();
    const match = presets.find((p) => p.path === v || p.path.replace(/\\/g, '/') === v.replace(/\\/g, '/'));
    return match?.id || CUSTOM_ID;
  }, [value, presets, useCustomPath]);

  const handleSelect = useCallback(
    (presetId: string) => {
      if (presetId === CUSTOM_ID) {
        setUseCustomPath(true);
        setValidationOk(null);
        setValidationMsg(null);
        return;
      }
      setUseCustomPath(false);
      const preset = presets.find((p) => p.id === presetId);
      if (preset) {
        onChange(preset.path);
        setValidationOk(null);
        setValidationMsg(null);
      }
    },
    [onChange, presets],
  );

  const validate = useCallback(async () => {
    const path = value.trim();
    if (!path) {
      setValidationOk(false);
      setValidationMsg('Выберите или укажите путь');
      return;
    }
    setValidating(true);
    setValidationMsg(null);
    try {
      const res = await validateCodingWorkspace(path);
      setValidationOk(res.ok);
      setValidationMsg(res.ok ? `OK: ${res.path}` : res.error || 'Некорректный путь');
      if (res.ok && res.path) onChange(res.path);
    } catch {
      setValidationOk(false);
      setValidationMsg('Не удалось проверить путь');
    } finally {
      setValidating(false);
    }
  }, [onChange, value]);

  const activePreset = presets.find((p) => p.id === selectedId);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <FormControl size="small" fullWidth disabled={disabled || loading}>
        <InputLabel id="workspace-preset-label" sx={{ color: muted }}>
          Workspace
        </InputLabel>
        <Select
          labelId="workspace-preset-label"
          label="Workspace"
          value={selectedId || (presets.length ? '' : CUSTOM_ID)}
          onChange={(e) => handleSelect(String(e.target.value))}
          sx={{ color: text, fontSize: 13 }}
        >
          {presets.map((p) => (
            <MenuItem key={p.id} value={p.id} disabled={!p.ok}>
              {p.label}
              {p.host_hint ? ` (${p.host_hint})` : ''}
              {!p.ok ? ' — недоступен' : ''}
            </MenuItem>
          ))}
          <MenuItem value={CUSTOM_ID}>Свой путь…</MenuItem>
        </Select>
      </FormControl>

      {(useCustomPath || selectedId === CUSTOM_ID || !presets.length) && (
        <TextField
          size="small"
          fullWidth
          disabled={disabled}
          autoFocus={useCustomPath}
          placeholder={serverDefault || 'F:/test_CLI или /workspaces/test_CLI'}
          value={value}
          onChange={(e) => {
            setUseCustomPath(true);
            onChange(e.target.value);
            setValidationOk(null);
          }}
          helperText="Windows-путь (F:/…) или Docker-путь (/workspaces/…)"
          sx={{ '& .MuiInputBase-input': { color: text, fontSize: 13 } }}
        />
      )}

      {!useCustomPath && activePreset?.host_hint && selectedId !== CUSTOM_ID && (
        <Typography variant="caption" sx={{ color: muted }}>
          На вашем ПК: {activePreset.host_hint}
        </Typography>
      )}

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          size="small"
          variant="outlined"
          onClick={() => void validate()}
          disabled={disabled || validating || !value.trim()}
        >
          {validating ? <CircularProgress size={14} /> : 'Проверить'}
        </Button>
        {showGlobalDefault && value.trim() && (
          <Button
            size="small"
            variant="text"
            onClick={() => setGlobalDefaultWorkspace(value.trim())}
            disabled={disabled}
          >
            {getGlobalDefaultWorkspace() === value.trim() ? '✓ Default для всех чатов' : 'Сделать default'}
          </Button>
        )}
        {validationOk != null && (
          <Typography variant="caption" sx={{ color: validationOk ? 'success.main' : 'error.main' }}>
            {validationMsg}
          </Typography>
        )}
      </Box>

      {loading && (
        <Typography variant="caption" sx={{ color: muted }}>
          Загрузка списка workspace…
        </Typography>
      )}

      {!loading && presets.length === 0 && (
        <Alert severity="info" sx={{ py: 0.25, fontSize: 12 }}>
          Пресеты не заданы в config.yml → coding_agent.workspace_presets
        </Alert>
      )}
    </Box>
  );
}

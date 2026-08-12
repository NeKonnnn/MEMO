import React, { useEffect, useState } from 'react';
import { TextField, type TextFieldProps } from '@mui/material';

export type ClampedNumberFieldProps = Omit<
  TextFieldProps,
  'value' | 'onChange' | 'type' | 'defaultValue'
> & {
  value: number;
  onValueChange: (value: number) => void;
  min: number;
  max: number;
  /** Значение при пустом/невалидном вводе на blur. */
  defaultValue: number;
  /** Целое число (parseInt) vs дробное (Number). */
  integer?: boolean;
  /** Округление дробных при commit (например порог схожести). */
  decimals?: number;
  step?: number;
};

function formatCommitted(n: number, integer: boolean, decimals?: number): string {
  if (integer) return String(Math.round(n));
  if (decimals != null) return String(Number(n.toFixed(decimals)));
  return String(n);
}

function parseRaw(raw: string, integer: boolean): number {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed === '' || trimmed === '-' || trimmed === '.' || trimmed === '-.') {
    return Number.NaN;
  }
  return integer ? parseInt(trimmed, 10) : Number(trimmed);
}

/**
 * Числовое поле без «скачков» при наборе: пока фокус — свободный текст,
 * min/max и default применяются только при blur (или Enter).
 */
export default function ClampedNumberField({
  value,
  onValueChange,
  min,
  max,
  defaultValue,
  integer = true,
  decimals,
  step,
  disabled,
  inputProps,
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}: ClampedNumberFieldProps) {
  const [text, setText] = useState(() => formatCommitted(value, integer, decimals));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setText(formatCommitted(value, integer, decimals));
    }
  }, [value, focused, integer, decimals]);

  const commit = (raw: string) => {
    const n = parseRaw(raw, integer);
    if (Number.isNaN(n)) {
      onValueChange(defaultValue);
      setText(formatCommitted(defaultValue, integer, decimals));
      return;
    }
    let next = Math.max(min, Math.min(max, n));
    if (integer) next = Math.round(next);
    else if (decimals != null) next = Number(next.toFixed(decimals));
    onValueChange(next);
    setText(formatCommitted(next, integer, decimals));
  };

  return (
    <TextField
      {...rest}
      disabled={disabled}
      type="text"
      value={text}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onChange={(e) => {
        if (disabled) return;
        const raw = e.target.value;
        // Промежуточные состояния: пусто, минус, точка, цифры
        if (raw === '' || /^-?\d*[.,]?\d*$/.test(raw)) {
          setText(raw);
        }
      }}
      onBlur={(e) => {
        setFocused(false);
        if (!disabled) commit(e.target.value);
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        }
        onKeyDown?.(e);
      }}
      inputProps={{
        inputMode: integer ? 'numeric' : 'decimal',
        ...inputProps,
        min,
        max,
        step,
      }}
    />
  );
}

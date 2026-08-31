import { useEffect, useState } from 'react';

/** Секунды с `startedAtMs`, пока `active`; иначе `null`. Тик раз в секунду. */
export function useElapsedSeconds(
  startedAtMs: number | null | undefined,
  active: boolean,
): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (!active || !startedAtMs || startedAtMs <= 0) {
      setElapsed(null);
      return undefined;
    }
    const tick = () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active, startedAtMs]);

  return elapsed;
}

/** Длительность генерации ответа: mm:ss, как у плагинов. */
export function formatGenerationDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const mm = Math.floor(safe / 60);
  const ss = safe % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export function computeGenerationDurationSec(startedAtMs: number | null | undefined): number {
  if (!startedAtMs || startedAtMs <= 0) return 1;
  return Math.max(1, Math.round((Date.now() - startedAtMs) / 1000));
}

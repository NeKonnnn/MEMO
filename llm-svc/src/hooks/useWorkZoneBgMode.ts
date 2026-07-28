import { useState, useEffect } from 'react';
import { getWorkZoneBgMode, type WorkZoneBgMode } from '../constants/workZoneBackground';

/** Текущий режим фона рабочей зоны (localStorage + interfaceSettingsChanged). */
export function useWorkZoneBgMode(): WorkZoneBgMode {
  const [mode, setMode] = useState<WorkZoneBgMode>(() => getWorkZoneBgMode());

  useEffect(() => {
    const on = () => setMode(getWorkZoneBgMode());
    window.addEventListener('interfaceSettingsChanged', on);
    return () => window.removeEventListener('interfaceSettingsChanged', on);
  }, []);

  return mode;
}

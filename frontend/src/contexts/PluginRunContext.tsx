/**
 * Запуски плагинов живут вне страницы галереи.
 *
 * Провайдер смонтирован в корне приложения, поэтому закрытие модального окна
 * или переход в чат не отменяет аудит: fetch продолжается, а результат ждёт
 * пользователя, пока он не запустит плагин с новым файлом.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAppActions } from './AppContext';
import { invokePlugin } from '../plugins/api';
import type { PluginInvokeResult } from '../plugins/types';
import {
  extractMarkdownFromResponse,
  normalizeInvokeResult,
  notificationForResultStatus,
  summaryForResultStatus,
} from '../plugins/verdict';
import { incrementTabNotification } from '../utils/tabNotifications';

export type PluginRunStatus = 'running' | 'done' | 'error';

export interface PluginRunRecord {
  pluginId: string;
  pluginName: string;
  status: PluginRunStatus;
  startedAtMs: number;
  finishedAtMs?: number;
  modelFileName: string;
  qualityFileName?: string;
  prompt?: string;
  /** Готовый markdown вердикта (или заглушка, если сервис вернул пустой ответ). */
  markdown?: string;
  /** Сырой ответ backend для вкладки JSON. */
  raw?: unknown;
  /** status из ответа сервиса: ok | degraded | error. */
  resultStatus?: string;
  summary?: string;
  error?: string;
}

export interface StartRunOptions {
  modelFile: File;
  qualityFile?: File | null;
  prompt?: string;
}

interface PluginRunContextValue {
  runs: Record<string, PluginRunRecord>;
  getRun: (pluginId: string) => PluginRunRecord | null;
  isRunning: (pluginId: string) => boolean;
  runningPlugins: PluginRunRecord[];
  /** Секунды с начала запуска (для завершённых — сколько он длился). */
  elapsedSec: (pluginId: string) => number;
  startRun: (plugin: { id: string; display_name?: string }, opts: StartRunOptions) => boolean;
  clearRun: (pluginId: string) => void;
}

const PluginRunContext = createContext<PluginRunContextValue>({
  runs: {},
  getRun: () => null,
  isRunning: () => false,
  runningPlugins: [],
  elapsedSec: () => 0,
  startRun: () => false,
  clearRun: () => {},
});

const STORAGE_KEY = 'plugin_runs_last';
const EMPTY_MARKDOWN_PLACEHOLDER =
  '# Аудит денежного потока\n\n**Статус:** ответ получен, но markdown пуст.\n\nОткройте вкладку **JSON** — там сырой ответ сервера.';

function loadPersistedRuns(): Record<string, PluginRunRecord> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, PluginRunRecord>;
    if (!parsed || typeof parsed !== 'object') return {};
    const restored: Record<string, PluginRunRecord> = {};
    for (const [pluginId, record] of Object.entries(parsed)) {
      if (!record || typeof record !== 'object') continue;
      if (record.status === 'running') {
        // fetch не переживает перезагрузку страницы, а сервис мог продолжить счёт.
        restored[pluginId] = {
          ...record,
          status: 'error',
          finishedAtMs: record.finishedAtMs || Date.now(),
          error:
            'Страница была перезагружена во время аудита — результат не получен. ' +
            'Сервис мог довести расчёт до конца: проверьте его логи или запустите аудит заново.',
        };
        continue;
      }
      restored[pluginId] = record;
    }
    return restored;
  } catch {
    return {};
  }
}

function persistRuns(runs: Record<string, PluginRunRecord>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
    return;
  } catch {
    // Квоту браузера искусственным лимитом не обойти: пробуем без сырого JSON.
  }
  try {
    const lighter: Record<string, PluginRunRecord> = {};
    for (const [pluginId, record] of Object.entries(runs)) {
      lighter[pluginId] = { ...record, raw: undefined };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lighter));
  } catch {
    /* переполненный или недоступный localStorage не должен ломать запуск */
  }
}

export function PluginRunProvider({ children }: { children: ReactNode }) {
  const { showNotification } = useAppActions();
  const [runs, setRuns] = useState<Record<string, PluginRunRecord>>(() => loadPersistedRuns());
  // Тик секундомера: попадает в deps value, иначе потребители не перерисуются.
  const [tick, setTick] = useState(0);
  const notifyRef = useRef(showNotification);
  notifyRef.current = showNotification;
  const inFlightRef = useRef<Set<string>>(new Set());

  const updateRun = useCallback((pluginId: string, patch: Partial<PluginRunRecord>) => {
    setRuns((prev) => {
      const current = prev[pluginId];
      if (!current) return prev;
      const next = { ...prev, [pluginId]: { ...current, ...patch } };
      persistRuns(next);
      return next;
    });
  }, []);

  const startRun = useCallback(
    (plugin: { id: string; display_name?: string }, opts: StartRunOptions): boolean => {
      const pluginId = plugin.id;
      if (!pluginId || !opts.modelFile) return false;
      if (inFlightRef.current.has(pluginId)) return false;
      inFlightRef.current.add(pluginId);

      const record: PluginRunRecord = {
        pluginId,
        pluginName: plugin.display_name || pluginId,
        status: 'running',
        startedAtMs: Date.now(),
        modelFileName: opts.modelFile.name,
        qualityFileName: opts.qualityFile?.name,
        prompt: opts.prompt?.trim() || undefined,
      };
      setRuns((prev) => {
        // Новый файл затирает предыдущий результат этого плагина — как просили.
        const next = { ...prev, [pluginId]: record };
        persistRuns(next);
        return next;
      });

      void (async () => {
        try {
          const res: PluginInvokeResult = await invokePlugin(pluginId, {
            modelFile: opts.modelFile,
            qualityFile: opts.qualityFile,
            prompt: opts.prompt,
          });
          const result = normalizeInvokeResult(res.result);
          const markdown = extractMarkdownFromResponse(res);
          const resultStatus = typeof result.status === 'string' ? result.status : undefined;
          updateRun(pluginId, {
            status: 'done',
            finishedAtMs: Date.now(),
            markdown: markdown || EMPTY_MARKDOWN_PLACEHOLDER,
            raw: res,
            resultStatus,
            summary: summaryForResultStatus(resultStatus),
            error: undefined,
          });
          notifyRef.current(
            resultStatus === 'error' ? 'error' : 'success',
            `${record.pluginName}: ${notificationForResultStatus(resultStatus)}`,
          );
        } catch (e: unknown) {
          const raw = e instanceof Error ? e.message.trim() : String(e ?? '').trim();
          const message =
            raw ||
            'Запуск плагина прервался без сообщения об ошибке. Проверьте логи backend (строки «Plugin invoke»).';
          updateRun(pluginId, {
            status: 'error',
            finishedAtMs: Date.now(),
            error: message,
          });
          notifyRef.current('error', `${record.pluginName}: ${message}`);
        } finally {
          inFlightRef.current.delete(pluginId);
          incrementTabNotification();
        }
      })();
      return true;
    },
    [updateRun],
  );

  const clearRun = useCallback((pluginId: string) => {
    setRuns((prev) => {
      if (!prev[pluginId] || prev[pluginId].status === 'running') return prev;
      const next = { ...prev };
      delete next[pluginId];
      persistRuns(next);
      return next;
    });
  }, []);

  const runningPlugins = useMemo(
    () => Object.values(runs).filter((r) => r.status === 'running'),
    [runs],
  );

  // Пока что-то выполняется — тикаем раз в секунду, чтобы обновлялся секундомер.
  useEffect(() => {
    if (!runningPlugins.length) return undefined;
    const timer = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(timer);
  }, [runningPlugins.length]);

  // Перезагрузка страницы обрывает fetch — предупреждаем, пока аудит идёт.
  useEffect(() => {
    if (!runningPlugins.length) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [runningPlugins.length]);

  const getRun = useCallback((pluginId: string) => runs[pluginId] || null, [runs]);
  const isRunning = useCallback(
    (pluginId: string) => runs[pluginId]?.status === 'running',
    [runs],
  );
  const elapsedSec = useCallback(
    (pluginId: string) => {
      const record = runs[pluginId];
      if (!record) return 0;
      const end = record.status === 'running' ? Date.now() : record.finishedAtMs || Date.now();
      return Math.max(0, Math.round((end - record.startedAtMs) / 1000));
    },
    [runs, tick],
  );

  const value = useMemo(
    () => ({ runs, getRun, isRunning, runningPlugins, elapsedSec, startRun, clearRun }),
    [runs, getRun, isRunning, runningPlugins, elapsedSec, startRun, clearRun],
  );

  return <PluginRunContext.Provider value={value}>{children}</PluginRunContext.Provider>;
}

export function usePluginRuns(): PluginRunContextValue {
  return useContext(PluginRunContext);
}

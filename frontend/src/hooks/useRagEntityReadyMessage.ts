import { useEffect, useRef, useState } from 'react';
import {
  ASTRA_RAG_ENTITY_SETTINGS_APPLIED,
  type RagEntitySettingsAppliedDetail,
} from '../constants/ragEntityEvents';
import { useRagReindexStatus } from './useRagReindexStatus';
import { isRagEntityRebuilding } from '../utils/ragReindexBlock';

function buildReadyMessage(
  scope: 'agent' | 'project',
  entityName?: string,
): string {
  const label = entityName?.trim();
  if (scope === 'agent') {
    return label
      ? `Настройки РАГ применены — можно пользоваться агентом «${label}» в чате.`
      : 'Настройки РАГ применены — можно пользоваться этим агентом в чате.';
  }
  return label
    ? `Настройки РАГ применены — можно пользоваться проектом «${label}».`
    : 'Настройки РАГ применены — можно пользоваться этим проектом.';
}

/**
 * Зелёное сообщение после сохранения настроек RAG сущности:
 * ждёт завершения перечанковки (если была) и показывает готовность.
 */
export function useRagEntityReadyMessage(
  scope: 'agent' | 'project',
  entityId: string | number | null | undefined,
  entityName?: string,
): { readyMessage: string | null; clearReadyMessage: () => void } {
  const { status } = useRagReindexStatus();
  const statusRef = useRef(status);
  statusRef.current = status;
  const [readyMessage, setReadyMessage] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const pendingNameRef = useRef<string | undefined>(entityName);

  const entityKey = entityId != null && entityId !== '' ? String(entityId) : '';

  useEffect(() => {
    pendingRef.current = false;
    setReadyMessage(null);
  }, [scope, entityKey]);

  useEffect(() => {
    pendingNameRef.current = entityName;
  }, [entityName]);

  useEffect(() => {
    const onApplied = (e: Event) => {
      const detail = (e as CustomEvent<RagEntitySettingsAppliedDetail>).detail;
      if (!detail || detail.scope !== scope) return;
      if (!entityKey || String(detail.entityId) !== entityKey) return;
      pendingRef.current = true;
      pendingNameRef.current = detail.entityName ?? entityName;
      if (!isRagEntityRebuilding(statusRef.current, scope, entityKey)) {
        setReadyMessage(buildReadyMessage(scope, pendingNameRef.current));
        pendingRef.current = false;
      }
    };
    window.addEventListener(ASTRA_RAG_ENTITY_SETTINGS_APPLIED, onApplied);
    return () => window.removeEventListener(ASTRA_RAG_ENTITY_SETTINGS_APPLIED, onApplied);
  }, [scope, entityKey, entityName]);

  useEffect(() => {
    if (!pendingRef.current || !entityKey) return;
    if (!isRagEntityRebuilding(status, scope, entityKey)) {
      setReadyMessage(buildReadyMessage(scope, pendingNameRef.current));
      pendingRef.current = false;
    }
  }, [status, scope, entityKey]);

  return {
    readyMessage,
    clearReadyMessage: () => setReadyMessage(null),
  };
}

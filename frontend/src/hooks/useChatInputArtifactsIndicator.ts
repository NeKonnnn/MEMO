import { useCallback, useEffect, useMemo, useState } from 'react';
import { AGENT_ARTIFACTS_CHANGED_EVENT } from '../utils/agentArtifactsEnabled';
import {
  ARTIFACTS_SELECTION_CHANGED_EVENT,
  getChatArtifactsToolsState,
  isChatArtifactsToolsActive,
  type ChatArtifactsToolsState,
} from '../utils/artifactsSelectionStorage';

export interface ArtifactsInputIndicator {
  active: boolean;
  settings: ChatArtifactsToolsState;
  tooltip: string;
}

function buildArtifactsIndicator(settings: ChatArtifactsToolsState): ArtifactsInputIndicator {
  const active = isChatArtifactsToolsActive(settings);
  const extras: string[] = [];
  if (settings.shadcn_enabled) extras.push('shadcn/ui');
  if (settings.user_prompt_mode) extras.push('свой промпт');

  let tooltip = '';
  if (active) {
    tooltip = `Режим артефактов: ${extras.join(', ')}.`;
  }

  return { active, settings, tooltip };
}

export function useChatInputArtifactsIndicator(
  chatId: string | null | undefined,
): ArtifactsInputIndicator {
  const [settings, setSettings] = useState<ChatArtifactsToolsState>(() =>
    getChatArtifactsToolsState(chatId),
  );

  const sync = useCallback(() => {
    setSettings(getChatArtifactsToolsState(chatId));
  }, [chatId]);

  useEffect(() => {
    sync();
    const onArtifacts = (e: Event) => {
      const detailChatId = (e as CustomEvent<{ chatId?: string }>).detail?.chatId;
      if (detailChatId && chatId && detailChatId !== chatId) return;
      sync();
    };
    window.addEventListener(ARTIFACTS_SELECTION_CHANGED_EVENT, onArtifacts as EventListener);
    window.addEventListener(AGENT_ARTIFACTS_CHANGED_EVENT, sync);
    window.addEventListener('agentSelected', sync as EventListener);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(ARTIFACTS_SELECTION_CHANGED_EVENT, onArtifacts as EventListener);
      window.removeEventListener(AGENT_ARTIFACTS_CHANGED_EVENT, sync);
      window.removeEventListener('agentSelected', sync as EventListener);
      window.removeEventListener('storage', sync);
    };
  }, [chatId, sync]);

  return useMemo(() => buildArtifactsIndicator(settings), [settings]);
}

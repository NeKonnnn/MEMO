import { useState, useEffect } from 'react';
import { getActiveAgentFromStorage } from '../components/AgentSelector';

export function dispatchAgentStatusChanged(anyActive?: boolean): void {
  if (typeof anyActive === 'boolean') {
    window.dispatchEvent(new CustomEvent('astrachatAgentStatusChanged', { detail: { anyActive } }));
    return;
  }
  window.dispatchEvent(new CustomEvent('astrachatAgentStatusChanged'));
}

/** Выбранный «мой» агент из localStorage + событие agentSelected. */
export function useMyAgentSelection(): { id: number; name: string; system_prompt: string } | null {
  const [sel, setSel] = useState(() => getActiveAgentFromStorage());

  useEffect(() => {
    const on = () => setSel(getActiveAgentFromStorage());
    window.addEventListener('agentSelected', on);
    return () => window.removeEventListener('agentSelected', on);
  }, []);

  return sel;
}

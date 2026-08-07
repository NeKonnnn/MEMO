import { persistAgentMcpConfig } from './applyAgentMcp';

const STORAGE_AGENT_ID = 'active_agent_id';
const STORAGE_AGENT_NAME = 'active_agent_name';
const STORAGE_AGENT_PROMPT = 'active_agent_prompt';

/** Снять выбранного пользовательского агента из чата (localStorage + событие). */
export function clearActiveAgent(): void {
  try {
    localStorage.removeItem(STORAGE_AGENT_ID);
    localStorage.removeItem(STORAGE_AGENT_NAME);
    localStorage.removeItem(STORAGE_AGENT_PROMPT);
    persistAgentMcpConfig(null);
    window.dispatchEvent(new CustomEvent('agentSelected', { detail: null }));
  } catch {
    /* */
  }
}

/** Применение MCP-настроек агента (config.mcp_*) к выбору серверов в чате. */

import { mcpServerToolId, setMcpToolIdsForChat } from '../mcp/selectionStorage';

export function getMcpToolIdsFromAgentConfig(
  config: Record<string, unknown> | undefined | null,
): string[] {
  if (!config || !config.mcp_enabled) return [];
  const raw = config.mcp_server_ids;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => String(x).trim())
    .filter(Boolean)
    .map((id) => mcpServerToolId(id));
}

export function applyAgentMcpToChat(
  chatId: string | null | undefined,
  config: Record<string, unknown> | undefined | null,
): void {
  if (!chatId || !config?.mcp_enabled) return;
  setMcpToolIdsForChat(chatId, getMcpToolIdsFromAgentConfig(config));
}

export function persistAgentMcpConfig(config: Record<string, unknown> | undefined | null): void {
  try {
    if (!config?.mcp_enabled) {
      localStorage.removeItem('active_agent_mcp_enabled');
      localStorage.removeItem('active_agent_mcp_server_ids');
      return;
    }
    localStorage.setItem('active_agent_mcp_enabled', 'true');
    const ids = Array.isArray(config.mcp_server_ids)
      ? config.mcp_server_ids.map((x) => String(x).trim()).filter(Boolean)
      : [];
    localStorage.setItem('active_agent_mcp_server_ids', JSON.stringify(ids));
  } catch {
    /* */
  }
}

export function applyStoredAgentMcpToChat(chatId: string | null | undefined): void {
  if (!chatId) return;
  try {
    if (localStorage.getItem('active_agent_mcp_enabled') !== 'true') return;
    const raw = localStorage.getItem('active_agent_mcp_server_ids');
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    applyAgentMcpToChat(chatId, {
      mcp_enabled: true,
      mcp_server_ids: Array.isArray(ids) ? ids : [],
    });
  } catch {
    /* */
  }
}

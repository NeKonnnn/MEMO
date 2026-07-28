import React from 'react';
import { AtlassianServerSettings } from './AtlassianServerSettings';
import type { ServerPluginProps } from '../types';

/** Плагины для карточек MCP в чате (Инструменты → MCP). */
const MCP_SERVER_PLUGINS: Record<string, React.ComponentType<ServerPluginProps>> = {
  atlassian: AtlassianServerSettings,
};

export function getMcpServerPlugin(serverId: string): React.ComponentType<ServerPluginProps> | null {
  return MCP_SERVER_PLUGINS[serverId] || null;
}

export { MCP_SERVER_PLUGINS };

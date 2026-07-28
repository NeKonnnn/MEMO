import React from 'react';
import AtlassianServerDetails from './AtlassianServerDetails';
import McpCredentialsSection from '../components/McpCredentialsSection';
import type { ServerPluginProps } from '../types';

/** Карточка Atlassian в чате: metadata + credentials. */
export function AtlassianServerSettings({ serverId, isDarkMode, compact, authMode }: ServerPluginProps) {
  if (serverId !== 'atlassian') return null;
  return (
    <>
      <AtlassianServerDetails serverId={serverId} isDarkMode={isDarkMode} compact={compact} />
      <McpCredentialsSection serverId={serverId} authMode={authMode} isDarkMode={isDarkMode} compact={compact} />
    </>
  );
}

export { AtlassianServerDetails };

import React from 'react';
import { Typography } from '@mui/material';
import { useAgentRagRebuilding } from '../hooks/useRagReindexStatus';

export const AGENT_RAG_APPLYING_LABEL = 'настройки ещё применяются';

interface ChatGearAgentReindexHintProps {
  agentId: number;
}

/** Подпись в меню «Инструменты → Агенты», пока идёт перечанковка документов агента. */
export default function ChatGearAgentReindexHint({ agentId }: ChatGearAgentReindexHintProps) {
  const rebuilding = useAgentRagRebuilding(agentId);
  if (!rebuilding) return null;

  return (
    <Typography
      component="span"
      sx={{
        flexShrink: 0,
        fontSize: '0.62rem',
        lineHeight: 1.15,
        color: 'warning.main',
        fontStyle: 'italic',
        whiteSpace: 'normal',
        maxWidth: 96,
        textAlign: 'right',
      }}
    >
      {AGENT_RAG_APPLYING_LABEL}
    </Typography>
  );
}

/** Строка-подпись под именем (если места справа мало). */
export function ChatGearAgentReindexHintSubline({ agentId }: ChatGearAgentReindexHintProps) {
  const rebuilding = useAgentRagRebuilding(agentId);
  if (!rebuilding) return null;

  return (
    <Typography
      sx={{
        fontSize: '0.62rem',
        color: 'warning.main',
        lineHeight: 1.2,
        fontStyle: 'italic',
      }}
    >
      {AGENT_RAG_APPLYING_LABEL}
    </Typography>
  );
}

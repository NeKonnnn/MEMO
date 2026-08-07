import { useRagReindexStatus } from '../contexts/RagReindexStatusContext';
import {
  shouldBlockRagSend,
  ragReindexBlockMessage,
  RAG_REINDEX_BLOCK_PLACEHOLDER,
  isRagEntityRebuilding,
  isRagReindexBannerVisible,
  type RagReindexStatusPayload,
  type RagSendBlockContext,
} from '../utils/ragReindexBlock';

export {
  useRagReindexStatus,
  shouldBlockRagSend,
  ragReindexBlockMessage,
  RAG_REINDEX_BLOCK_PLACEHOLDER,
  isRagEntityRebuilding,
  isRagReindexBannerVisible,
};
export type { RagReindexStatusPayload, RagSendBlockContext };

/** Идёт ли перечанковка KB у конкретного агента. */
export function useAgentRagRebuilding(agentId: number | null | undefined): boolean {
  const { status } = useRagReindexStatus();
  if (agentId == null || !Number.isFinite(agentId)) return false;
  return isRagEntityRebuilding(status, 'agent', agentId);
}

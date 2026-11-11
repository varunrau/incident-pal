import { request } from '../../../shared/client/helpers.js';
import type { ApprovalDecision, ChatMessage } from '../../types.js';

export function decideApproval(id: string, decision: ApprovalDecision, token: string) {
  return request<ChatMessage>(`/api/chat/approvals/${encodeURIComponent(id)}`, { body: { decision }, token });
}

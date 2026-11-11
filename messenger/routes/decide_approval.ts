import type { FastifyInstance } from 'fastify';
import type { Chat } from '../chat.js';
import type { ApprovalDecision, ChatApproval, ChatAuthor } from '../types.js';
import { withAuth, type Requirements } from './auth.js';

export interface Decision {
  approval: ChatApproval;
  channel: string;
  decision: ApprovalDecision;
  author: ChatAuthor;
}

// Runs a decision. Throwing leaves the request pending.
export type DecisionHandler = (decision: Decision) => void;

export function decideApproval(app: FastifyInstance, chat: Chat, auth: Requirements, onDecision: DecisionHandler) {
  app.post<{ Params: { id: string }; Body: { decision: ApprovalDecision } }>('/approvals/:id', {
    schema: {
      params: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 64 } } },
      body: {
        type: 'object', required: ['decision'], additionalProperties: false,
        properties: { decision: { type: 'string', enum: ['approve', 'reject'] } },
      },
    },
  }, withAuth(auth.participant, async ({ params, body }, reply, author) =>
    chat.decideApproval(params.id, body.decision, author, (approval, channel) =>
      onDecision({ approval, channel, decision: body.decision, author }))));
}

import type { FlagId } from '../payments/types.js';

export interface ChatChannel {
  id: string;
  topic: string;
}

export interface ChatAuthor {
  id: string;
  name: string;
  // URL of the author's avatar image.
  avatar: string;
}

// What runs when an approval request is approved. It is fixed when the request is posted.
export type ApprovalAction = { kind: 'update_flag'; flag: FlagId; enabled: boolean };

export type ApprovalDecision = 'approve' | 'reject';

export interface ChatApproval {
  id: string;
  action: ApprovalAction;
  // The only participants who can approve or reject.
  approvers: ChatAuthor[];
  status: 'pending' | 'approved' | 'rejected';
  decidedBy?: ChatAuthor;
  decidedAt?: number;
}

export interface ChatMessage {
  id: number;
  channel: string;
  author: ChatAuthor;
  text: string;
  at: number;
  // Set when the message asks people to approve or reject an action.
  approval?: ChatApproval;
}

export interface ChatSnapshot {
  channels: ChatChannel[];
  messages: ChatMessage[];
  // Channels where Ampersand is working on a reply.
  thinking: string[];
}

export interface ChatThinking {
  channel: string;
  thinking: boolean;
}

export interface ChatSession {
  author: ChatAuthor;
  token: string;
}

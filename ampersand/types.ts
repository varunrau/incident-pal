import type { AgentSessionItem } from 'openai/resources/beta/agents/agents.js';

export interface AmpersandTranscript {
  sessionId: string | null;
  instructions: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number | null } | null;
  items: AmpersandTranscriptItem[];
  nextCursor: string | null;
}

// One transcript row. `type` selects the fields that exist, and `raw` is the item as Ampersand
// returned it.
export type AmpersandTranscriptItem =
  | { type: 'message'; id: string | null; role: 'user' | 'assistant'; text: string; senderName: string | null; channel: string | null; raw: AgentSessionItem }
  | { type: 'function_call'; id: string; name: string; status: string; raw: AgentSessionItem }
  | { type: 'function_call_output'; id: string; callId: string; status: string; raw: AgentSessionItem }
  | { type: 'other'; id: string | null; itemType: string; raw: AgentSessionItem };

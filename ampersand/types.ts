export interface AmpersandTranscript {
  sessionId: string | null;
  instructions: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number | null } | null;
  items: AmpersandTranscriptItem[];
  nextCursor: string | null;
}

export interface AmpersandTranscriptItem {
  id?: string | null;
  type?: string;
  role?: 'user' | 'assistant';
  content?: { text?: string; type?: string }[];
  metadata?: { channel?: string; sender_name?: string } | null;
  name?: string;
  call_id?: string;
  status?: string | null;
}

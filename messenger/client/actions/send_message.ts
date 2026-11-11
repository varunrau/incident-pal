import { request } from '../../../shared/client/helpers.js';
import type { ChatMessage } from '../../types.js';
import { randomNonce } from '../helpers.js';

// The last unconfirmed send in each channel. Sending the same text again reuses its nonce, so a
// retry after a lost response does not post the message twice.
const unconfirmed = new Map<string, { text: string; nonce: string }>();

export async function sendMessage(channel: string, text: string, token: string) {
  let attempt = unconfirmed.get(channel);
  if (attempt?.text !== text) {
    attempt = { text, nonce: randomNonce() };
    unconfirmed.set(channel, attempt);
  }
  const message = await request<ChatMessage>(`/api/chat/channels/${encodeURIComponent(channel)}/messages`, { body: attempt, token });
  unconfirmed.delete(channel);
  return message;
}

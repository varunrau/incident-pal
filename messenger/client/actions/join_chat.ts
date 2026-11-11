import { request } from '../../../shared/client/helpers.js';
import type { ChatSession } from '../../types.js';

// Joins with a display name. Sending the current token keeps the participant's avatar.
export function joinChat(name: string, token?: string) {
  return request<ChatSession>('/api/chat/participants', { body: { name }, token });
}

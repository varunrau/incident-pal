import { request } from '../../../shared/client/helpers.js';
import type { ChatChannel } from '../../types.js';

export function createChannel(name: string, token: string) {
  return request<ChatChannel>('/api/chat/channels', { body: { name }, token });
}

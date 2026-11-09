import type { Chat } from '../../messenger/chat.js';
import type { Tool } from './index.js';
import { channelField, object } from './schemas.js';

export function readChannel(chat: Chat): Tool<{ channel: string; before?: number; limit?: number }> {
  return {
    name: 'read_channel',
    description: 'Read messages in one channel, newest first. Pass nextBefore as before for older messages.',
    parameters: object({
      channel: channelField,
      before: { type: 'integer', minimum: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    }, ['channel']),
    execute: ({ channel, before, limit }) => chat.readChannel(channel, before, limit),
  };
}

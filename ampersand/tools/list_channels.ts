import type { createChat } from '../../messenger/chat.js';
import type { Tool } from './index.js';
import { object } from './schemas.js';

export function listChannels(chat: ReturnType<typeof createChat>): Tool {
  return {
    name: 'list_channels',
    description: 'List all chat channels with their IDs and topics.',
    parameters: object(),
    execute: () => ({ channels: chat.listChannels() }),
  };
}

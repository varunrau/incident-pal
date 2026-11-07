import type { createChat } from '../chat.js';
import type { Tool } from './index.js';
import { channelField, object } from './schemas.js';

const ampersandAuthor = { id: 'agent:ampersand', name: 'Ampersand' };

export function sendMessage(chat: ReturnType<typeof createChat>): Tool<{ channel: string; text: string }> {
  return {
    name: 'send_message',
    description: 'Post as Ampersand in a chat channel.',
    parameters: object({
      channel: channelField,
      text: { type: 'string', minLength: 1, maxLength: 2_000, pattern: '\\S' },
    }, ['channel', 'text']),
    execute: ({ channel, text }) => ({ message: chat.postMessage(channel, ampersandAuthor, text.trim()) }),
    agentOnly: true,
  };
}

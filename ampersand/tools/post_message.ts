import type { Chat } from '../../messenger/chat.js';
import type { Tool } from './index.js';
import { channelField, object } from './schemas.js';

const ampersandAuthor = { id: 'agent:ampersand', name: 'Ampersand' };

export function postMessage(chat: Chat): Tool<{ channel: string; text: string }> {
  return {
    name: 'post_message',
    description: 'Post as Ampersand in a chat channel.',
    parameters: object({
      channel: channelField,
      text: { type: 'string', minLength: 1, maxLength: 2_000, pattern: '\\S' },
    }, ['channel', 'text']),
    execute: ({ channel, text }) => ({ message: chat.postMessage(channel, ampersandAuthor, text.trim()) }),
    };
}

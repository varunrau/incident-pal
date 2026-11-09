import type { FastifyInstance } from 'fastify';
import { messageLimit, type Chat } from '../chat.js';
import type { ChatMessage } from '../types.js';

const BODY_LIMIT_BYTES = 32_768;

export function createMessage(app: FastifyInstance, chat: Chat, onMessage: (message: ChatMessage) => void) {
  app.post<{ Params: { channel: string }; Body: { text: string; nonce: string } }>('/channels/:channel/messages', {
    bodyLimit: BODY_LIMIT_BYTES,
    schema: {
      body: {
        type: 'object', required: ['text', 'nonce'], additionalProperties: false,
        properties: {
          text: { type: 'string', minLength: 1, maxLength: messageLimit, pattern: '\\S' },
          nonce: { type: 'string', pattern: '^[0-9a-f]{32}$' },
        },
      },
    },
  }, async ({ params, body, headers }, reply) => {
    const author = chat.participant(headers.authorization);
    if (!author) return reply.code(401).send({ message: 'Choose a display name to join the chat.' });

    const previous = chat.findByNonce(params.channel, author.id, body.nonce);
    if (previous) return previous;

    const message = chat.postMessage(params.channel, author, body.text.trim(), body.nonce);
    onMessage(message);
    return reply.code(201).send(message);
  });
}

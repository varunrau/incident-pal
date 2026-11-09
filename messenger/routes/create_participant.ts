import type { FastifyInstance } from 'fastify';
import type { Chat } from '../chat.js';
import type { ChatSession } from '../types.js';

export function createParticipant(app: FastifyInstance, chat: Chat) {
  app.post<{ Body: { name: string }; Reply: ChatSession }>('/participants', {
    schema: {
      body: {
        type: 'object', required: ['name'], additionalProperties: false,
        properties: { name: { type: 'string', minLength: 1, maxLength: 40, pattern: '\\S' } },
      },
    },
  }, async ({ body, headers }, reply) => reply.code(201).send(chat.join(body.name.trim(), headers.authorization)));
}

import type { FastifyInstance } from 'fastify';
import type { Chat } from '../chat.js';
import { withAuth, type Requirements } from './auth.js';

export function createParticipant(app: FastifyInstance, chat: Chat, auth: Requirements) {
  app.post<{ Body: { name: string } }>('/participants', {
    schema: {
      body: {
        type: 'object', required: ['name'], additionalProperties: false,
        properties: { name: { type: 'string', minLength: 1, maxLength: 40, pattern: '\\S' } },
      },
    },
  }, withAuth(auth.optionalParticipant, async ({ body }, reply, previous) =>
    reply.code(201).send(chat.join(body.name.trim(), previous))));
}

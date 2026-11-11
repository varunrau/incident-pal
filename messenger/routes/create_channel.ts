import type { FastifyInstance } from 'fastify';
import type { Chat } from '../chat.js';
import { withAuth, type Requirements } from './auth.js';

export function createChannel(app: FastifyInstance, chat: Chat, auth: Requirements) {
  app.post<{ Body: { name: string } }>('/channels', {
    schema: {
      body: {
        type: 'object', required: ['name'], additionalProperties: false,
        properties: { name: { type: 'string', minLength: 1, maxLength: 60 } },
      },
    },
  }, withAuth(auth.participant, async ({ body }, reply) => {
    const id = body.name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      return reply.code(400).send({ message: 'Use letters and numbers separated by spaces or hyphens.' });
    }
    return reply.code(201).send(chat.createChannel(id));
  }));
}

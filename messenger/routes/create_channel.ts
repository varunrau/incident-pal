import type { FastifyInstance } from 'fastify';
import type { Chat } from '../chat.js';

export function createChannel(app: FastifyInstance, chat: Chat) {
  app.post<{ Body: { name: string } }>('/channels', {
    schema: {
      body: {
        type: 'object', required: ['name'], additionalProperties: false,
        properties: { name: { type: 'string', minLength: 1, maxLength: 60 } },
      },
    },
  }, async ({ body, headers }, reply) => {
    if (!chat.participant(headers.authorization)) {
      return reply.code(401).send({ message: 'Choose a display name to create a channel.' });
    }
    const id = body.name.trim().toLowerCase().replace(/\s+/g, '-');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      return reply.code(400).send({ message: 'Use letters and numbers separated by spaces or hyphens.' });
    }
    return reply.code(201).send(chat.createChannel(id));
  });
}

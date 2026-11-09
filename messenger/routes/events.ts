import type { FastifyInstance } from 'fastify';
import type { Chat } from '../chat.js';

const HEARTBEAT_MS = 15_000;

export function events(app: FastifyInstance, chat: Chat) {
  app.get('/events', { exposeHeadRoute: false }, (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    chat.subscribe(reply.raw);
  });

  const heartbeat = setInterval(() => chat.heartbeat(), HEARTBEAT_MS).unref();
  app.addHook('preClose', async () => {
    clearInterval(heartbeat);
    chat.disconnectAll();
  });
}

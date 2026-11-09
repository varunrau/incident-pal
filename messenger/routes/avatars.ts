import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { avatarNames } from '../chat.js';

export async function avatars(app: FastifyInstance) {
  await Promise.all(avatarNames.map(async avatar => {
    const image = await readFile(new URL(`../../../messenger/public/avatars/${avatar}.webp`, import.meta.url));
    app.get(`/avatars/${avatar}.webp`, async (request, reply) =>
      reply.type('image/webp').header('Cache-Control', 'public, max-age=3600').send(image));
  }));
}

import { readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { pathToFileURL } from 'node:url';
import Fastify, { LogController } from 'fastify';
import { Ampersand } from './ampersand/agent.js';
import { Chat } from './messenger/chat.js';
import { chatRoutes } from './messenger/routes/index.js';
import { checkoutRoutes, startShoppers } from './payments/checkout.js';
import { Telemetry } from './payments/telemetry.js';
import { createAgentTools } from './ampersand/tools/index.js';
import { level, object, setFlagBody } from './ampersand/tools/schemas.js';
import type { Level, SetFlag } from './payments/types.js';

export function buildApp({
  simulate = true, logger = false, ampersandApiKey,
}: { simulate?: boolean; logger?: boolean; ampersandApiKey: string }) {
  if (!ampersandApiKey?.trim()) {
    throw new Error('Set AMPERSAND_API_KEY in .env or the shell before starting Incident Pal.');
  }

  const app = Fastify({ logger, logController: new LogController({ disableRequestLogging: true }) });
  const chat = new Chat();
  const telemetry = new Telemetry();
  const agent = new Ampersand(ampersandApiKey, createAgentTools(chat, telemetry), app.log);
  app.addHook('preClose', () => agent.close());

  app.get<{ Querystring: { after?: string; sessionId?: string } }>('/api/ampersand/transcript', {
    schema: {
      querystring: object({
        after: { type: 'string', minLength: 1, maxLength: 256 },
        sessionId: { type: 'string', minLength: 1, maxLength: 256 },
      }),
    },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return agent.transcript(request.query.after, request.query.sessionId);
  });

  app.register(checkoutRoutes, { prefix: '/shop', telemetry });
  app.register(chatRoutes, {
    prefix: '/api/chat',
    chat,
    onMessage(message) {
      agent.send({
        id: `chat:${message.id}`,
        text: message.text,
        metadata: {
          source: 'chat', sender: message.author.id, sender_name: message.author.name,
          channel: message.channel, timestamp: Math.floor(message.at / 1_000),
        },
      });
    },
  });
  app.register(async web => {
    const files = [
      ['/', '../payments/public/index.html', 'text/html'],
      ['/flags', '../payments/public/flags.html', 'text/html'],
      ['/app.js', './payments/client/app.js', 'text/javascript'],
      ['/flags.js', './payments/client/flags.js', 'text/javascript'],
      ['/chat', '../messenger/public/chat.html', 'text/html'],
      ['/chat.js', './messenger/client/chat.js', 'text/javascript'],
      ['/ampersand', '../ampersand/public/ampersand.html', 'text/html'],
      ['/ampersand.js', './ampersand/client/ampersand.js', 'text/javascript'],
      ['/style.css', '../shared/public/style.css', 'text/css'],
      ['/pal.svg', '../shared/public/pal.svg', 'image/svg+xml'],
      ['/og.png', '../shared/public/og.png', 'image/png'],
      ['/fonts/ibm-plex-sans.woff2', '../shared/public/fonts/ibm-plex-sans.woff2', 'font/woff2'],
    ];
    await Promise.all(files.map(async ([route, file, type]) => {
      const body = await readFile(new URL(file, import.meta.url));
      const contentType = type.startsWith('text/') ? `${type}; charset=utf-8` : type;
      web.get(route, async (request, reply) => reply.type(contentType).send(body));
    }));
  });

  app.get<{ Querystring: { level?: Level } }>('/api/dashboard', {
    schema: { querystring: object({ level }) },
  }, async request => ({
    health: telemetry.health(),
    flags: telemetry.flagLog(),
    logs: telemetry.queryLogs(request.query).entries,
  }));

  app.get('/api/flags', async () => telemetry.flagLog());
  app.post<{ Body: SetFlag }>('/api/flags', {
    schema: { body: setFlagBody },
  }, async ({ body }) => telemetry.setFlag(body.flag, body.enabled, 'human'));
  if (simulate) {
    let stop: ReturnType<typeof startShoppers> | undefined;
    app.addHook('onListen', async () => {
      const address = app.server.address();
      if (address && typeof address !== 'string') {
        const host = address.address === '0.0.0.0' ? '127.0.0.1' : address.address === '::' ? '::1' : address.address;
        const hostname = host.includes(':') ? `[${host}]` : host;
        stop = startShoppers(`http://${hostname}:${address.port}`, app.log);
      }
    });
    app.addHook('preClose', async () => { await stop?.(); });
  }

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    const app = buildApp({ logger: true, ampersandApiKey: process.env.AMPERSAND_API_KEY ?? '' });
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => app.close().catch(error => {
        app.log.error(error);
        process.exitCode = 1;
      }));
    }
    const port = Number(process.env.PORT ?? 3000);
    const address = await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
    app.log.info(`Incident Pal dashboard at ${address}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

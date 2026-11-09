import { randomInt, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import type { FastifyPluginAsync } from 'fastify';
import { shoppers } from '../shared/demo-shoppers.js';
import { responseChannel, statusChannel, type ChatAuthor, type ChatChannel, type ChatMessage, type ChatSession, type ChatSnapshot } from './types.js';

type SeedMessage = [supportAuthor: string | null, text: string];

const customerHistory: Record<(typeof shoppers)[number]['id'], SeedMessage[]> = {
  'shopper-01': [
    [null, 'Is the field notebook back in stock? I wanted to order one for a weekend trip.'],
    ['Alex Kim', 'It’s back in stock. The product page should let you add it to your cart now.'],
    [null, 'That worked. I placed the order from my phone and got the receipt.'],
    ['Alex Kim', 'Glad it went through. You’ll get a separate email when it ships.'],
  ],
  'shopper-02': [
    [null, 'Mon panier affiche des euros. Le reçu sera-t-il aussi en euros ?'],
    ['Maya Chen', 'Oui, le reçu utilise la devise affichée au moment du paiement.'],
    [null, 'Merci. Je viens de finaliser ma commande et le reçu indique bien le montant attendu.'],
    ['Maya Chen', 'Parfait. N’hésitez pas à nous écrire sur ce canal si vous avez besoin d’une copie plus tard.'],
  ],
  'shopper-03': [
    [null, 'I left a notebook in my cart this morning and it was gone when I came back.'],
    ['Priya Shah', 'Inactive carts expire. Add the notebook again to get a fresh cart.'],
    [null, 'I added it again and the new order went through.'],
    ['Priya Shah', 'Thanks for checking. Your order confirmation should be in your inbox.'],
  ],
  'shopper-04': [
    [null, 'I got a receipt, but the tracking page hasn’t updated yet.'],
    ['Jon Reyes', 'Tracking starts updating after the carrier scans the parcel. The receipt confirms we received the order.'],
    [null, 'It updated this afternoon. Thanks for explaining the difference.'],
    ['Jon Reyes', 'Glad it’s moving. The tracking page will show the delivery estimate.'],
  ],
};

const customerChannels = shoppers.map(({ id, name }) => {
  const slug = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    id: `customer-${slug}`, name, topic: `Customer support for ${name} · ${id}`, history: customerHistory[id],
  };
});

const defaultChannels: ChatChannel[] = [
  { id: responseChannel, topic: 'Technical discussion for responders' },
  { id: statusChannel, topic: 'Updates on impact and recovery for stakeholders' },
  { id: 'all-water-cooler', topic: 'General workspace conversation' },
  { id: 'eng-core-payments', topic: 'Checkout and payment engineering' },
  { id: 'eng-growth', topic: 'Growth experiments and onboarding' },
  { id: 'eng-fulfillment', topic: 'Orders, inventory, and fulfillment' },
  ...customerChannels.map(({ id, topic }) => ({ id, topic })),
];

const projectHistory: Array<[channel: string, author: string, text: string]> = [
  ['all-water-cooler', 'Maya Chen', 'Coffee in the kitchen if anyone needs a refill.'],
  ['all-water-cooler', 'Priya Shah', 'Thanks! I’ll swing by after standup.'],
  ['eng-core-payments', 'Jon Reyes', 'Checkout smoke tests passed this morning. Browse, cart, and payment all returned 2xx.'],
  ['eng-core-payments', 'Maya Chen', 'Thanks. I’ll check the payment logs after the next test run.'],
  ['eng-growth', 'Priya Shah', 'The onboarding copy experiment is ready for a review.'],
  ['eng-growth', 'Alex Kim', 'I’ll check the mobile flow this afternoon.'],
  ['eng-fulfillment', 'Alex Kim', 'Inventory sync finished. The field notebook is available for checkout.'],
  ['eng-fulfillment', 'Jon Reyes', 'Thanks. The fulfillment job still starts when checkout creates an order.'],
  ...customerChannels.flatMap(({ id, name, history }) =>
    history.map(([supportAuthor, message]): [string, string, string] => [id, supportAuthor ?? name, message])),
];

const rosterAvatars = new Map([
  ['Maya Chen', 'sprout-gecko'],
  ['Priya Shah', 'lantern-moth'],
  ['Jon Reyes', 'cloud-ray'],
  ['Alex Kim', 'acorn-ram'],
]);
const joinAvatars = ['pebble-turtle', 'sun-puff', 'moss-hare', 'reef-axolotl'];

const historyLimit = 100;
const messageLimit = 2_000;

interface MessageInput {
  text: string;
  nonce: string;
}

function event(name: 'snapshot' | 'channel' | 'message', data: ChatSnapshot | ChatChannel | ChatMessage) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createChat() {
  const channels = [...defaultChannels];
  const participants = new Map<string, ChatAuthor>();
  const availableAvatars = [...joinAvatars];
  const clients = new Set<ServerResponse>();
  const histories = new Map(channels.map(channel => [
    channel.id, [] as Array<{ message: ChatMessage; nonce?: string }>,
  ]));
  let sequence = 0;
  const now = Date.now();
  for (const [index, [channel, name, text]] of projectHistory.entries()) {
    histories.get(channel)?.push({
      message: { id: ++sequence, channel, author: { id: `seed:${name}`, name, avatar: rosterAvatars.get(name) }, text, at: now - (projectHistory.length - index) * 60_000 },
    });
  }

  function pickAvatar() {
    if (!availableAvatars.length) availableAvatars.push(...joinAvatars);
    const [avatar] = availableAvatars.splice(randomInt(availableAvatars.length), 1);
    return avatar;
  }

  function broadcast(payload: string) {
    for (const stream of clients) {
      if (stream.writableNeedDrain) stream.destroy();
      else if (!stream.destroyed && !stream.writableEnded) stream.write(payload);
    }
  }

  function participant(authorization?: string) {
    if (authorization?.startsWith('Bearer ')) return participants.get(authorization.slice(7));
  }

  function postMessage(channel: string, author: ChatAuthor, text: string, nonce?: string) {
    const history = histories.get(channel);
    if (!history) throw Object.assign(new Error('Channel not found.'), { statusCode: 404 });
    const message = { id: ++sequence, channel, author, text, at: Date.now() };
    history.push({ message, nonce });
    if (history.length > historyLimit) history.shift();
    broadcast(event('message', message));
    return message;
  }

  function readChannel(channel: string, before?: number, limit = 25) {
    const history = histories.get(channel);
    if (!history) throw Object.assign(new Error('Channel not found.'), { statusCode: 404 });
    const matches = history.filter(item => before === undefined || item.message.id < before);
    const messages = matches.slice(-limit).reverse().map(item => item.message);
    return { messages, nextBefore: matches.length > limit ? messages.at(-1)!.id : null };
  }

  const routes: FastifyPluginAsync<{
    onMessage: (message: ChatMessage) => void;
  }> = async (app, { onMessage }) => {
    await Promise.all([...rosterAvatars.values(), ...joinAvatars].map(async avatar => {
      const image = await readFile(new URL(`../../messenger/public/avatars/${avatar}.webp`, import.meta.url));
      app.get(`/avatars/${avatar}.webp`, async (request, reply) =>
        reply.type('image/webp').header('Cache-Control', 'public, max-age=3600').send(image));
    }));

    app.post<{ Body: { name: string }; Reply: ChatSession }>('/participants', {
      schema: {
        body: {
          type: 'object', required: ['name'], additionalProperties: false,
          properties: { name: { type: 'string', minLength: 1, maxLength: 40, pattern: '\\S' } },
        },
      },
    }, async ({ body, headers }, reply) => {
      const avatar = participant(headers.authorization)?.avatar ?? pickAvatar();
      const author = { id: randomUUID(), name: body.name.trim(), avatar };
      const token = randomUUID();
      participants.set(token, author);
      return reply.code(201).send({ author, token });
    });

    app.post<{ Body: { name: string } }>('/channels', {
      schema: {
        body: {
          type: 'object', required: ['name'], additionalProperties: false,
          properties: { name: { type: 'string', minLength: 1, maxLength: 60 } },
        },
      },
    }, async ({ body, headers }, reply) => {
      if (!participant(headers.authorization)) {
        return reply.code(401).send({ message: 'Choose a display name to create a channel.' });
      }
      const id = body.name.trim().toLowerCase().replace(/\s+/g, '-');
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
        return reply.code(400).send({ message: 'Use letters and numbers separated by spaces or hyphens.' });
      }
      if (histories.has(id)) {
        return reply.code(409).send({ message: `#${id} already exists.` });
      }

      const channel = { id, topic: '' };
      histories.set(id, []);
      channels.push(channel);
      broadcast(event('channel', channel));
      return reply.code(201).send(channel);
    });

    app.post<{ Params: { channel: string }; Body: MessageInput }>('/channels/:channel/messages', {
      bodyLimit: 32_768,
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
      const author = participant(headers.authorization);
      if (!author) {
        return reply.code(401).send({ message: 'Choose a display name to join the chat.' });
      }
      const history = histories.get(params.channel);
      if (!history) return reply.code(404).send({ message: 'Channel not found.' });

      const previous = history.find(item => item.nonce === body.nonce && item.message.author.id === author.id);
      if (previous) return previous.message;

      const message = postMessage(params.channel, author, body.text.trim(), body.nonce);
      onMessage(message);
      return reply.code(201).send(message);
    });

    app.get('/events', { exposeHeadRoute: false }, (request, reply) => {
      reply.hijack();
      const stream = reply.raw;
      stream.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      });
      clients.add(stream);
      stream.once('close', () => clients.delete(stream));
      stream.write(event('snapshot', {
        channels,
        messages: [...histories.values()].flatMap(history => history.map(item => item.message)),
      }));
    });

    const heartbeat = setInterval(() => broadcast(': heartbeat\n\n'), 15_000).unref();
    app.addHook('preClose', async () => {
      clearInterval(heartbeat);
      for (const stream of clients) stream.end();
      clients.clear();
    });
  };

  return {
    routes, postMessage, readChannel, listChannels: () => channels.slice(),
  };
}

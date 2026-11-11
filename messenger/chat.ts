import { randomInt, randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { shoppers } from '../shared/demo-shoppers.js';
import type { ChatAuthor, ChatChannel, ChatMessage, ChatSession, ChatSnapshot } from './types.js';

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
  { id: 'incident-response', topic: 'Technical discussion for responders' },
  { id: 'global-incident-status', topic: 'Updates on impact and recovery for stakeholders' },
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
const defaultAvatar = joinAvatars[0];

const historyLimit = 100;
const seedMessageSpacingMs = 60_000;

export const messageLimit = 2_000;
export const avatarNames = [...rosterAvatars.values(), ...joinAvatars];
const avatarUrl = (name: string) => `/api/chat/avatars/${name}.webp`;

interface HistoryEntry {
  message: ChatMessage;
  nonce?: string;
}

class ChannelNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super('Channel not found.');
  }
}

export class ChannelExistsError extends Error {
  readonly statusCode = 409;

  constructor(id: string) {
    super(`#${id} already exists.`);
  }
}

function event(name: 'snapshot' | 'channel' | 'message', data: ChatSnapshot | ChatChannel | ChatMessage) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

export class Chat {
  private readonly channels = [...defaultChannels];
  private readonly participants = new Map<string, ChatAuthor>();
  private readonly availableAvatars = [...joinAvatars];
  private readonly clients = new Set<ServerResponse>();
  private readonly histories = new Map<string, HistoryEntry[]>(this.channels.map(channel => [channel.id, []]));
  private sequence = 0;

  constructor() {
    const now = Date.now();
    for (const [index, [channel, name, text]] of projectHistory.entries()) {
      this.histories.get(channel)?.push({
        message: {
          id: ++this.sequence, channel, author: { id: `seed:${name}`, name, avatar: avatarUrl(rosterAvatars.get(name) ?? defaultAvatar) }, text,
          at: now - (projectHistory.length - index) * seedMessageSpacingMs,
        },
      });
    }
  }

  participant(token: string) {
    return this.participants.get(token);
  }

  // A returning participant keeps their avatar when they change their name.
  join(name: string, previous?: ChatAuthor): ChatSession {
    const avatar = previous?.avatar ?? avatarUrl(this.pickAvatar());
    const author = { id: randomUUID(), name, avatar };
    const token = randomUUID();
    this.participants.set(token, author);
    return { author, token };
  }

  listChannels() {
    return this.channels.slice();
  }

  createChannel(id: string) {
    if (this.histories.has(id)) throw new ChannelExistsError(id);
    const channel = { id, topic: '' };
    this.histories.set(id, []);
    this.channels.push(channel);
    this.broadcast(event('channel', channel));
    return channel;
  }

  postMessage(channel: string, author: ChatAuthor, text: string, nonce?: string) {
    const history = this.history(channel);
    const message = { id: ++this.sequence, channel, author, text, at: Date.now() };
    history.push({ message, nonce });
    if (history.length > historyLimit) history.shift();
    this.broadcast(event('message', message));
    return message;
  }

  findByNonce(channel: string, authorId: string, nonce: string) {
    return this.history(channel).find(item => item.nonce === nonce && item.message.author.id === authorId)?.message;
  }

  readChannel(channel: string, before?: number, limit = 25) {
    const matches = this.history(channel).filter(item => before === undefined || item.message.id < before);
    const messages = matches.slice(-limit).reverse().map(item => item.message);
    return { messages, nextBefore: matches.length > limit ? messages.at(-1)!.id : null };
  }

  subscribe(stream: ServerResponse) {
    this.clients.add(stream);
    stream.once('close', () => this.clients.delete(stream));
    stream.write(event('snapshot', {
      channels: this.channels,
      messages: [...this.histories.values()].flatMap(history => history.map(item => item.message)),
    }));
  }

  heartbeat() {
    this.broadcast(': heartbeat\n\n');
  }

  disconnectAll() {
    for (const stream of this.clients) stream.end();
    this.clients.clear();
  }

  private history(channel: string) {
    const history = this.histories.get(channel);
    if (!history) throw new ChannelNotFoundError();
    return history;
  }

  private pickAvatar() {
    if (!this.availableAvatars.length) this.availableAvatars.push(...joinAvatars);
    const [avatar] = this.availableAvatars.splice(randomInt(this.availableAvatars.length), 1);
    return avatar;
  }

  private broadcast(payload: string) {
    for (const stream of this.clients) {
      if (stream.writableNeedDrain) stream.destroy();
      else if (!stream.destroyed && !stream.writableEnded) stream.write(payload);
    }
  }
}

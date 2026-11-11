import { randomInt, randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { seedChannels, seedMessages } from './seed.js';
import type {
  ApprovalAction, ApprovalDecision, ChatApproval, ChatAuthor, ChatChannel, ChatMessage, ChatSession, ChatSnapshot, ChatThinking,
} from './types.js';

const rosterAvatars = new Map([
  ['Maya Chen', 'sprout-gecko'],
  ['Priya Shah', 'lantern-moth'],
  ['Jon Reyes', 'cloud-ray'],
  ['Alex Kim', 'acorn-ram'],
]);
const joinAvatars = ['pebble-turtle', 'sun-puff', 'moss-hare', 'reef-axolotl'];
const defaultAvatar = joinAvatars[0];

const historyLimit = 100;

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

class ApprovalNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super('That approval request is no longer in the chat history.');
  }
}

class UnknownApproverError extends Error {
  readonly statusCode = 400;

  constructor(id: string) {
    super(`${id} is not a chat participant. Approvers must be participant IDs, such as a message's author.id.`);
  }
}

class NotApproverError extends Error {
  readonly statusCode = 403;

  constructor(approvers: ChatAuthor[]) {
    super(`Only ${approvers.map(approver => approver.name).join(', ')} can approve or reject this request.`);
  }
}

class ApprovalDecidedError extends Error {
  readonly statusCode = 409;

  constructor({ status, decidedBy }: ChatApproval) {
    super(`This request was already ${status}${decidedBy ? ` by ${decidedBy.name}` : ''}.`);
  }
}

function event(
  name: 'snapshot' | 'channel' | 'message' | 'message_updated' | 'thinking',
  data: ChatSnapshot | ChatChannel | ChatMessage | ChatThinking,
) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

export class Chat {
  private readonly channels = [...seedChannels];
  private readonly participants = new Map<string, ChatAuthor>();
  private readonly availableAvatars = [...joinAvatars];
  private readonly clients = new Set<ServerResponse>();
  private readonly histories = new Map<string, HistoryEntry[]>(this.channels.map(channel => [channel.id, []]));
  // Channels where Ampersand is working on a reply.
  private readonly thinking = new Set<string>();
  private sequence = 0;

  constructor() {
    for (const { channel, author: name, text, at } of seedMessages()) {
      const author = { id: `seed:${name}`, name, avatar: avatarUrl(rosterAvatars.get(name) ?? defaultAvatar) };
      this.histories.get(channel)?.push({ message: { id: ++this.sequence, channel, author, text, at } });
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

  postMessage(channel: string, author: ChatAuthor, text: string, nonce?: string, approval?: ChatApproval) {
    const history = this.history(channel);
    const message: ChatMessage = { id: ++this.sequence, channel, author, text, at: Date.now(), ...(approval && { approval }) };
    history.push({ message, nonce });
    if (history.length > historyLimit) history.shift();
    this.broadcast(event('message', message));
    return message;
  }

  // Posts a message that the participants in `approverIds` can approve or reject. `action` is
  // stored with the message, so approving runs exactly what was shown.
  requestApproval(channel: string, author: ChatAuthor, text: string, action: ApprovalAction, approverIds: string[]) {
    this.history(channel);
    const participants = [...this.participants.values()];
    const approvers = [...new Set(approverIds)].map(id => {
      const approver = participants.find(participant => participant.id === id);
      if (!approver) throw new UnknownApproverError(id);
      return approver;
    });
    const approval: ChatApproval = { id: randomUUID(), action, approvers, status: 'pending' };
    return { message: this.postMessage(channel, author, text, undefined, approval), approval };
  }

  // Records a decision on a pending approval. `settle` runs the decision.
  // Everything here is synchronous, so two people deciding at once cannot both run it. If `settle`
  // throws, the request stays pending.
  decideApproval(id: string, decision: ApprovalDecision, author: ChatAuthor, settle: (approval: ChatApproval, channel: string) => void) {
    const entry = [...this.histories.values()].flat().find(item => item.message.approval?.id === id);
    const approval = entry?.message.approval;
    if (!entry || !approval) throw new ApprovalNotFoundError();
    if (!approval.approvers.some(approver => approver.id === author.id)) throw new NotApproverError(approval.approvers);
    if (approval.status !== 'pending') throw new ApprovalDecidedError(approval);

    settle(approval, entry.message.channel);
    const status = decision === 'approve' ? 'approved' : 'rejected';
    entry.message = { ...entry.message, approval: { ...approval, status, decidedBy: author, decidedAt: Date.now() } };
    this.broadcast(event('message_updated', entry.message));
    return entry.message;
  }

  setThinking(channel: string, thinking: boolean) {
    if (!this.histories.has(channel) || this.thinking.has(channel) === thinking) return;
    if (thinking) this.thinking.add(channel);
    else this.thinking.delete(channel);
    this.broadcast(event('thinking', { channel, thinking }));
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
      thinking: [...this.thinking],
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

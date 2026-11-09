import type { FastifyPluginAsync } from 'fastify';
import type { Chat } from '../chat.js';
import type { ChatMessage } from '../types.js';
import { avatars } from './avatars.js';
import { createChannel } from './create_channel.js';
import { createMessage } from './create_message.js';
import { createParticipant } from './create_participant.js';
import { events } from './events.js';

export const chatRoutes: FastifyPluginAsync<{ chat: Chat; onMessage: (message: ChatMessage) => void }> = async (app, { chat, onMessage }) => {
  await avatars(app);
  createParticipant(app, chat);
  createChannel(app, chat);
  createMessage(app, chat, onMessage);
  events(app, chat);
};

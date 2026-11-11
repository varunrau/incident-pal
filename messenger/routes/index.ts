import type { FastifyPluginAsync } from 'fastify';
import type { Chat } from '../chat.js';
import type { ChatMessage } from '../types.js';
import { requirements } from './auth.js';
import { avatars } from './avatars.js';
import { createChannel } from './create_channel.js';
import { createMessage } from './create_message.js';
import { createParticipant } from './create_participant.js';
import { events } from './events.js';

export const chatRoutes: FastifyPluginAsync<{ chat: Chat; onMessage: (message: ChatMessage) => void }> = async (app, { chat, onMessage }) => {
  const auth = requirements(chat);
  await avatars(app);
  createParticipant(app, chat, auth);
  createChannel(app, chat, auth);
  createMessage(app, chat, auth, onMessage);
  events(app, chat);
};

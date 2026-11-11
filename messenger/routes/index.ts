import type { FastifyPluginAsync } from 'fastify';
import type { Chat } from '../chat.js';
import type { ChatMessage } from '../types.js';
import { requirements } from './auth.js';
import { avatars } from './avatars.js';
import { createChannel } from './create_channel.js';
import { createMessage } from './create_message.js';
import { createParticipant } from './create_participant.js';
import { decideApproval, type DecisionHandler } from './decide_approval.js';
import { events } from './events.js';

export const chatRoutes: FastifyPluginAsync<{
  chat: Chat;
  onMessage: (message: ChatMessage) => void;
  onDecision: DecisionHandler;
}> = async (app, { chat, onMessage, onDecision }) => {
  const auth = requirements(chat);
  await avatars(app);
  createParticipant(app, chat, auth);
  createChannel(app, chat, auth);
  createMessage(app, chat, auth, onMessage);
  decideApproval(app, chat, auth, onDecision);
  events(app, chat);
};

import type { FastifyReply, FastifyRequest, RouteGenericInterface } from 'fastify';
import type { Chat } from '../chat.js';
import type { ChatAuthor } from '../types.js';

export class UnauthorizedError extends Error {
  readonly statusCode = 401;

  constructor() {
    super('Choose a display name to join the chat.');
  }
}

// Checks what a route needs from the caller. It returns what the handler receives, or throws an
// error with a `statusCode` that Fastify sends instead.
export type Requirement<T> = (request: FastifyRequest) => T;

export type Requirements = ReturnType<typeof requirements>;

// The built-in requirements. Routes pick one with `withAuth` instead of checking headers.
export function requirements(chat: Chat) {
  const bearer = ({ headers: { authorization } }: FastifyRequest) =>
    authorization?.startsWith('Bearer ') ? chat.participant(authorization.slice('Bearer '.length)) : undefined;

  return {
    // A valid participant token. The handler receives the participant.
    participant: ((request) => {
      const author = bearer(request);
      if (!author) throw new UnauthorizedError();
      return author;
    }) satisfies Requirement<ChatAuthor>,
    // A participant token if the caller sent a valid one, and undefined otherwise.
    optionalParticipant: bearer satisfies Requirement<ChatAuthor | undefined>,
  };
}

// Runs `requirement` before `handler` and passes its result to the handler.
export function withAuth<T, Route extends RouteGenericInterface>(
  requirement: Requirement<T>,
  handler: (request: FastifyRequest<Route>, reply: FastifyReply, auth: T) => Promise<unknown>,
) {
  return (request: FastifyRequest<Route>, reply: FastifyReply) => handler(request, reply, requirement(request));
}

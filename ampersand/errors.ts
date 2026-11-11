// Errors raised by the Ampersand integration. `statusCode` is the response Fastify sends when
// one of these reaches a route.
export class AmpersandError extends Error {
  constructor(message: string, readonly statusCode: number, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class SessionChangedError extends AmpersandError {
  constructor() {
    super('The session changed. Refresh the transcript.', 409);
  }
}

export class SessionNotFoundError extends AmpersandError {
  constructor(options?: ErrorOptions) {
    super('Ampersand could not find the active session.', 502, options);
  }
}

export class TranscriptLoadError extends AmpersandError {
  constructor(options?: ErrorOptions) {
    super('Could not load the transcript from Ampersand.', 502, options);
  }
}

export class UnknownToolError extends AmpersandError {
  constructor(name: string) {
    super(`Unknown tool: ${name}`, 400);
  }
}

export class InvalidToolArgumentsError extends AmpersandError {
  constructor(name: string, details: string) {
    super(`Invalid ${name} arguments: ${details}`, 400);
  }
}

export class RoutineLimitError extends AmpersandError {
  constructor(max: number) {
    super(`You already have ${max} routines. Cancel one before scheduling another.`, 400);
  }
}

export class RoutineNotFoundError extends AmpersandError {
  constructor(id: string) {
    super(`No active routine with ID ${id}. It may have expired or been cancelled.`, 404);
  }
}

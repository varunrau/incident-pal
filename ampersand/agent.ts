import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyBaseLogger } from 'fastify';
import OpenAI from 'openai';
import type {
  AgentSession, AgentSessionInputMessageParam, AgentSessionInputParam, TokenUsage,
} from 'openai/resources/beta/agents/agents.js';
import { AmpersandClosedError, SessionChangedError, SessionNotFoundError, TranscriptLoadError } from './errors.js';
import type { AmpersandTranscript } from './types.js';

export const AMPERSAND_BASE_URL = 'https://ampersand.humansand.ai/v1';
const MODEL = 'ampersand-v0.1';

const REQUEST_TIMEOUT_MS = 15_000;
const STREAM_RECONNECT_MS = 180_000;
const CLOSE_TIMEOUT_MS = 2_000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30_000;
const BACKOFF_MAX_DOUBLINGS = 6;
const TRANSCRIPT_PAGE_SIZE = 25;

// Ampersand requires non-empty input to create a session, and that input starts a turn.
const SESSION_START_INPUT: AgentInput = {
  id: 'session-start',
  text: 'This session has started. Nothing needs a response yet, so finish quietly and wait for the next message.',
  metadata: { source: 'system', sender_name: 'System' },
};
const REJECTED_INPUT_STATUSES = [400, 413];

// https://ampersand.humansand.ai/docs/PRICING.html
const USD_PER_MILLION_INPUT_TOKENS = 1;
const USD_PER_MILLION_CACHED_TOKENS = 0.2;
const USD_PER_MILLION_OUTPUT_TOKENS = 5.2;

export interface AgentInput {
  id: string;
  text: string;
  metadata: Record<string, string | number>;
}

export interface AgentTools {
  definitions: { type: 'function'; name: string; description: string; parameters: Record<string, unknown> }[];
  execute(name: string, args: unknown): object | Promise<object>;
}

type FunctionCall = Extract<AgentSession['required_actions'][number], { type: 'function_call' }>;
type ToolResult = Extract<AgentSessionInputParam, { type: 'agent.session.input.tool_result' }>;

interface LiveSession {
  id: string;
  controller: AbortController;
  // Tool calls (`turn_id:call_id`) already executed in this session. A call runs at most once,
  // however often it reappears in required_actions; its result is retried until Ampersand
  // accepts it or the session ends.
  handled: Set<string>;
}

const callKey = (call: FunctionCall) => `${call.turn_id}:${call.call_id}`;
const replaceNul = (text: string) => text.replaceAll('\0', '�');

function toMessage({ id, text, metadata }: AgentInput) {
  const cleaned = Object.entries(metadata).map(([key, value]) => [key, typeof value === 'string' ? replaceNul(value) : value]);
  // `metadata` is an Ampersand extension that the OpenAI types do not declare.
  const message: AgentSessionInputMessageParam & { metadata: object } = {
    role: 'user',
    content: [{ type: 'input_text', text: replaceNul(text) }],
    metadata: { ...Object.fromEntries(cleaned), id },
  };
  return message;
}

function estimateCostUsd(usage: TokenUsage) {
  const cached = usage.input_tokens_details?.cached_tokens;
  if (cached === undefined) return null;
  return ((usage.input_tokens - cached) * USD_PER_MILLION_INPUT_TOKENS
    + cached * USD_PER_MILLION_CACHED_TOKENS
    + usage.output_tokens * USD_PER_MILLION_OUTPUT_TOKENS) / 1_000_000;
}

function summarizeUsage(usage: TokenUsage | null): AmpersandTranscript['usage'] {
  if (!usage) return null;
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, estimatedCostUsd: estimateCostUsd(usage) };
}

async function backoff(failures: number, signal: AbortSignal) {
  const wait = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(failures, BACKOFF_MAX_DOUBLINGS));
  await delay(wait, undefined, { signal, ref: false }).catch(() => {});
}

// Owns the one Ampersand session this server drives. `start` opens it. If it later fails or
// disappears, the next input opens a replacement.
export class Ampersand {
  private readonly sessions: OpenAI['beta']['agents']['sessions'];
  private readonly instructions = readFileSync(new URL('../../ampersand/prompts/ampersand.md', import.meta.url), 'utf8').trimEnd();
  private readonly toolNames: Set<string>;
  private readonly lifetime = new AbortController();
  private readonly queue: AgentInput[] = [];
  private session?: LiveSession;
  private closed = false;
  private draining = false;

  constructor(apiKey: string, private readonly tools: AgentTools, private readonly log: FastifyBaseLogger) {
    this.sessions = new OpenAI({ apiKey, baseURL: AMPERSAND_BASE_URL, timeout: REQUEST_TIMEOUT_MS }).beta.agents.sessions;
    this.toolNames = new Set(tools.definitions.map(tool => tool.name));
  }

  async start() {
    await this.open();
  }

  send(input: AgentInput) {
    this.queue.push(input);
    void this.drain();
  }

  async transcript(after?: string, sessionId?: string): Promise<AmpersandTranscript> {
    const session = this.session;
    if (after && session?.id !== sessionId) throw new SessionChangedError();
    const transcript: AmpersandTranscript = {
      sessionId: session?.id ?? null, instructions: this.instructions, model: MODEL, usage: null, items: [], nextCursor: null,
    };
    if (!session) return transcript;

    const options = { signal: this.lifetime.signal };
    try {
      const [saved, page] = await Promise.all([
        this.sessions.retrieve(session.id, options),
        this.sessions.items.list(session.id, { limit: TRANSCRIPT_PAGE_SIZE, order: 'desc', after }, options),
      ]);
      transcript.usage = summarizeUsage(saved.usage);
      transcript.items = page.data;
      transcript.nextCursor = page.hasNextPage() ? page.data.at(-1)?.id ?? null : null;
      return transcript;
    } catch (cause) {
      throw cause instanceof OpenAI.NotFoundError ? new SessionNotFoundError({ cause }) : new TranscriptLoadError({ cause });
    }
  }

  async close() {
    const session = this.session;
    this.closed = true;
    this.session = undefined;
    this.lifetime.abort();
    session?.controller.abort();
    if (session) await this.remove(session.id, AbortSignal.timeout(CLOSE_TIMEOUT_MS));
  }

  private async open() {
    // `ampersand` is an extension that the OpenAI types do not declare.
    const agent = {
      model: MODEL, instructions: this.instructions, tools: this.tools.definitions, ampersand: { compaction: 'auto', allow_silent_completion: false },
    };
    const created = await this.sessions.create({
      agent, environment: { type: 'none' }, input: [toMessage(SESSION_START_INPUT)],
    }, { signal: this.lifetime.signal });
    if (this.closed) {
      void this.remove(created.id, AbortSignal.timeout(CLOSE_TIMEOUT_MS));
      throw new AmpersandClosedError();
    }
    const session: LiveSession = { id: created.id, controller: new AbortController(), handled: new Set() };
    this.session = session;
    void this.watch(session);
    return session;
  }

  private async remove(id: string, signal = this.lifetime.signal) {
    await this.sessions.delete(id, { signal, maxRetries: 0 }).catch(() => {});
  }

  private end(session: LiveSession) {
    if (this.session !== session) return;
    session.controller.abort();
    this.session = undefined;
    void this.remove(session.id);
    void this.drain();
  }

  // True when a failed call means this session has nothing left to retry.
  private sessionEnded(session: LiveSession, error: unknown) {
    if (session.controller.signal.aborted) return true;
    if (!(error instanceof OpenAI.NotFoundError)) return false;
    this.end(session);
    return true;
  }

  // Repeats `attempt` with backoff until it returns or the session ends. `attempt` calls its
  // argument after making progress, which resets the backoff. `isSettled` can stop the retries
  // when the failure shows there is no more work to do.
  private async retry(
    session: LiveSession,
    message: string,
    attempt: (progressed: () => void) => Promise<void>,
    isSettled: (error: unknown) => Promise<boolean> = async () => false,
  ) {
    let failures = 0;
    while (!session.controller.signal.aborted) {
      try {
        return await attempt(() => { failures = 0; });
      } catch (error) {
        if (this.sessionEnded(session, error) || await isSettled(error)) return;
        this.log.warn({ err: error }, message);
        await backoff(failures++, session.controller.signal);
      }
    }
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      let failures = 0;
      while (this.queue.length && !this.closed) {
        const input = this.queue[0];
        let session: LiveSession | undefined;
        try {
          session = this.session ?? await this.open();
          await this.sessions.events.create(session.id, {
            events: [{ type: 'agent.session.input.message', input: [toMessage(input)] }],
            'Idempotency-Key': `input:${input.id}`,
          }, { signal: session.controller.signal });
          if (this.session === session) this.queue.shift();
          failures = 0;
        } catch (error) {
          if (this.closed || (session && this.sessionEnded(session, error))) continue;
          this.log.warn({ err: error, inputId: input.id }, 'Could not deliver Ampersand input');
          if (session && error instanceof OpenAI.APIError && REJECTED_INPUT_STATUSES.includes(error.status)) {
            this.queue.shift();
            continue;
          }
          await backoff(failures++, this.lifetime.signal);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async watch(session: LiveSession) {
    const { signal } = session.controller;
    while (!signal.aborted) {
      await this.retry(session, 'Reconnecting Ampersand event stream', progressed => this.followEvents(session, progressed));
      await backoff(0, signal);
    }
  }

  private async followEvents(session: LiveSession, progressed: () => void) {
    const { signal } = session.controller;
    const stream = await this.sessions.events.stream(session.id, {
      maxRetries: 0, signal: AbortSignal.any([signal, AbortSignal.timeout(STREAM_RECONNECT_MS)]),
    });
    // The stream has no replay cursor. Reconcile after opening it so calls issued before or
    // during reconnection are still handled.
    void this.sessions.retrieve(session.id, { signal }).then(saved => this.applyState(session, saved)).catch(error => {
      if (!this.sessionEnded(session, error)) this.log.warn({ err: error }, 'Could not reconcile Ampersand session');
    });
    for await (const event of stream) {
      progressed();
      if ('session' in event) this.applyState(session, event.session);
      if (event.type === 'agent.session.turn.failed') {
        this.log.warn({ turnId: event.turn.id, failure: event.turn.error }, 'Ampersand turn failed');
      }
    }
  }

  private applyState(session: LiveSession, saved: AgentSession) {
    if (this.session !== session) return;
    if (saved.status === 'failed') {
      this.log.warn({ reason: saved.error }, 'Ampersand session failed');
      this.end(session);
    } else {
      this.runToolCalls(session, saved.required_actions);
    }
  }

  // Runs every new tool call concurrently. A call is marked handled before anything awaits, so
  // a repeated state update cannot start it twice.
  private runToolCalls(session: LiveSession, actions: AgentSession['required_actions'] = []) {
    const calls = actions.filter((action): action is FunctionCall =>
      action.type === 'function_call' && this.toolNames.has(action.name) && !session.handled.has(callKey(action)));
    for (const call of calls) {
      session.handled.add(callKey(call));
      void this.executeAndReport(session, call);
    }
  }

  private async executeAndReport(session: LiveSession, call: FunctionCall) {
    const result = await this.execute(call);
    await this.retry(session, `Retrying Ampersand tool result for ${call.name}`, async () => {
      await this.sessions.events.create(session.id, {
        events: [result], 'Idempotency-Key': `tool:${callKey(call)}`,
      }, { signal: session.controller.signal });
    }, async error => {
      if (!(error instanceof OpenAI.BadRequestError || error instanceof OpenAI.ConflictError)) return false;
      const saved = await this.sessions.retrieve(session.id, { signal: session.controller.signal }).catch(() => undefined);
      return saved !== undefined && !saved.required_actions.some(action =>
        action.type === 'function_call' && callKey(action) === callKey(call));
    });
  }

  private async execute({ turn_id, call_id, name, arguments: args }: FunctionCall): Promise<ToolResult> {
    const type = 'agent.session.input.tool_result';
    try {
      return { type, turn_id, call_id, success: true, output: JSON.stringify(await this.tools.execute(name, args)) };
    } catch (error) {
      return { type, turn_id, call_id, success: false, error: error instanceof Error ? error.message : 'Tool failed.' };
    }
  }
}

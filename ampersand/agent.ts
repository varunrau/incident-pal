import { readFileSync } from 'node:fs';
import type { FastifyBaseLogger } from 'fastify';
import OpenAI from 'openai';
import type { AgentToolHandler } from 'openai/lib/agents/agent-session-stream.js';
import type { AgentSessionInputMessageParam, AgentSessionItem, TokenUsage } from 'openai/resources/beta/agents/agents.js';
import { SessionChangedError, SessionNotFoundError, TranscriptLoadError } from './errors.js';
import type { AmpersandTranscript, AmpersandTranscriptItem } from './types.js';

const AMPERSAND_BASE_URL = 'https://ampersand.humansand.ai/v1';
const MODEL = 'ampersand-v0.1';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 5;
const TURN_TIMEOUT_MS = 5 * 60_000;
const CLOSE_TIMEOUT_MS = 2_000;
const TRANSCRIPT_PAGE_SIZE = 25;

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

// Follows each turn's progress. `toolStarted` runs before a tool executes and `toolFinished` after
// it returns, including when it fails. `turnEnded` runs after the turn, whether or not it succeeded.
export interface TurnObserver {
  toolStarted(inputs: AgentInput[], name: string, args: unknown): void;
  toolFinished(inputs: AgentInput[], name: string, args: unknown): void;
  turnEnded(inputs: AgentInput[]): void;
}

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

// Reads a string from the message metadata Ampersand echoes back, which the OpenAI types omit.
function metadataString(item: AgentSessionItem, key: string) {
  const metadata: unknown = 'metadata' in item ? item.metadata : undefined;
  if (typeof metadata !== 'object' || metadata === null) return null;
  const value: unknown = Reflect.get(metadata, key);
  return typeof value === 'string' ? value : null;
}

function toTranscriptItem(item: AgentSessionItem): AmpersandTranscriptItem {
  switch (item.type) {
    case 'message':
      return {
        type: 'message', id: item.id, role: item.role, raw: item,
        text: item.content.map(part => 'text' in part ? part.text : `[${part.type}]`).join('\n'),
        senderName: metadataString(item, 'sender_name'),
        channel: metadataString(item, 'channel'),
      };
    case 'function_call':
      return { type: 'function_call', id: item.id, name: item.name, status: item.status, raw: item };
    case 'function_call_output':
      return { type: 'function_call_output', id: item.id, callId: item.call_id, status: item.status, raw: item };
    default:
      return { type: 'other', id: item.id, itemType: item.type, raw: item };
  }
}

// Drives this server's Ampersand session. The first input creates the session. Inputs run one turn
// at a time. Inputs that arrive during a turn join it at its next tool call, or are sent together
// as the next turn if it makes none. The SDK runs each turn, including executing tool calls and
// submitting their results.
export class Ampersand {
  private readonly sessions: OpenAI['beta']['agents']['sessions'];
  private readonly instructions = readFileSync(new URL('../../ampersand/prompts/ampersand.md', import.meta.url), 'utf8').trimEnd();
  private readonly toolHandlers: Record<string, AgentToolHandler>;
  private readonly lifetime = new AbortController();
  private readonly queue: AgentInput[] = [];
  private sessionId?: string;
  private running = false;
  // The inputs of the running turn, including any that joined it. Observers receive this array.
  private current: AgentInput[] = [];

  constructor(
    apiKey: string,
    private readonly tools: AgentTools,
    private readonly log: FastifyBaseLogger,
    private readonly observers: TurnObserver[] = [],
  ) {
    this.sessions = new OpenAI({
      apiKey, baseURL: AMPERSAND_BASE_URL, timeout: REQUEST_TIMEOUT_MS, maxRetries: MAX_RETRIES,
    }).beta.agents.sessions;
    this.toolHandlers = Object.fromEntries(tools.definitions.map(({ name }) => [name, args => this.runTool(name, args)]));
  }

  send(input: AgentInput) {
    this.queue.push(input);
    void this.run();
  }

  async transcript(after?: string, sessionId?: string): Promise<AmpersandTranscript> {
    const id = this.sessionId;
    if (after && id !== sessionId) throw new SessionChangedError();
    const transcript: AmpersandTranscript = {
      sessionId: id ?? null, instructions: this.instructions, model: MODEL, usage: null, items: [], nextCursor: null,
    };
    if (!id) return transcript;

    const options = { signal: this.lifetime.signal };
    try {
      const [saved, page] = await Promise.all([
        this.sessions.retrieve(id, options),
        this.sessions.items.list(id, { limit: TRANSCRIPT_PAGE_SIZE, order: 'desc', after }, options),
      ]);
      transcript.usage = summarizeUsage(saved.usage);
      transcript.items = page.data.map(toTranscriptItem);
      transcript.nextCursor = page.hasNextPage() ? page.data.at(-1)?.id ?? null : null;
      return transcript;
    } catch (cause) {
      throw cause instanceof OpenAI.NotFoundError ? new SessionNotFoundError({ cause }) : new TranscriptLoadError({ cause });
    }
  }

  async close() {
    this.lifetime.abort();
    if (this.sessionId) await this.remove(this.sessionId, AbortSignal.timeout(CLOSE_TIMEOUT_MS));
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && !this.lifetime.signal.aborted) {
        const inputs = this.queue.splice(0);
        this.current = inputs;
        try {
          await this.turn(inputs);
        } catch (error) {
          if (this.lifetime.signal.aborted) return;
          this.log.warn({ err: error, inputIds: inputs.map(input => input.id) }, 'Ampersand turn failed');
          await this.recover();
        } finally {
          this.current = [];
          for (const observer of this.observers) observer.turnEnded(inputs);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async turn(inputs: AgentInput[]) {
    const input = inputs.map(toMessage);
    const options = { signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(TURN_TIMEOUT_MS)]) };
    if (this.sessionId) {
      const params = { input, toolHandlers: this.toolHandlers, idempotencyKey: `input:${inputs[0].id}` };
      await this.sessions.stream(this.sessionId, params, options).finalResult();
      return;
    }

    // `ampersand` is an extension that the OpenAI types do not declare.
    const agent = {
      model: MODEL, instructions: this.instructions, tools: this.tools.definitions,
      ampersand: { compaction: 'auto', allow_silent_completion: true },
    };
    const stream = (await this.sessions.create({
      agent, environment: { type: 'none' }, input, stream: true, toolHandlers: this.toolHandlers,
    }, options)).withResultCollection();
    // Read up to the creation event so the transcript and shutdown can use the session during its
    // first turn. `finalResult` then continues from the same events.
    const events = stream[Symbol.asyncIterator]();
    for (let next = await events.next(); !next.done; next = await events.next()) {
      if (next.value.type === 'agent.session.created') {
        this.sessionId = next.value.session.id;
        break;
      }
    }
    await stream.finalResult();
  }

  // Keeps the session if it is idle and can take the next turn. Otherwise deletes it, and the
  // next input creates a new one.
  private async recover() {
    const id = this.sessionId;
    if (!id) return;
    const saved = await this.sessions.retrieve(id, { signal: this.lifetime.signal }).catch(() => undefined);
    if (saved?.status === 'idle') return;
    this.sessionId = undefined;
    await this.remove(id);
  }

  private async remove(id: string, signal = this.lifetime.signal) {
    await this.sessions.delete(id, { signal, maxRetries: 0 }).catch(() => {});
  }

  // The SDK replaces a thrown error with a generic message, so failures are returned as output
  // the model can read.
  private async runTool(name: string, args: unknown) {
    const joined = this.joinTurn();
    const inputs = this.current;
    for (const observer of this.observers) observer.toolStarted(inputs, name, args);
    try {
      return await this.tools.execute(name, args);
    } catch (error) {
      this.log.warn({ err: error, tool: name }, 'Ampersand tool failed');
      return { error: error instanceof Error ? error.message : 'Tool failed.' };
    } finally {
      await joined;
      for (const observer of this.observers) observer.toolFinished(inputs, name, args);
    }
  }

  // Sends inputs that arrived during this turn into it, so Ampersand reads them before it
  // continues. This runs during a tool call, and the turn waits for that call's result, which is
  // sent only after this finishes. So the turn cannot end before the inputs arrive. If sending
  // fails, the inputs go back to the queue for the next turn.
  private async joinTurn() {
    const id = this.sessionId;
    if (!id || !this.queue.length) return;
    const inputs = this.queue.splice(0);
    this.current.push(...inputs);
    try {
      await this.sessions.events.create(id, {
        events: [{ type: 'agent.session.input.message', input: inputs.map(toMessage) }],
        'Idempotency-Key': `join:${inputs[0].id}`,
      }, { signal: this.lifetime.signal });
    } catch (error) {
      if (this.lifetime.signal.aborted) return;
      this.log.warn({ err: error, inputIds: inputs.map(input => input.id) }, 'Ampersand could not add inputs to the running turn');
      this.current.splice(this.current.length - inputs.length, inputs.length);
      this.queue.unshift(...inputs);
    }
  }
}

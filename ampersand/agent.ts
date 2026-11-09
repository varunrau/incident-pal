import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyBaseLogger } from 'fastify';
import type { createAgentTools } from './tools/index.js';
import type { AmpersandTranscript } from './types.js';

export interface AmpersandConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface AgentInput {
  id: string;
  sender: string;
  sender_name: string;
  channel: string;
  timestamp: number;
  text: string;
}

interface Action {
  type: string;
  turn_id: string;
  call_id: string;
  name: string;
  arguments: unknown;
}

interface SessionState {
  id: string;
  status: 'idle' | 'in_progress' | 'requires_action' | 'failed';
  error?: string | null;
  metadata?: Record<string, string>;
  required_actions?: Action[];
  usage?: {
    input_tokens: number;
    input_tokens_details?: { cached_tokens: number };
    output_tokens: number;
  } | null;
}

type AgentTools = ReturnType<typeof createAgentTools>;
type Receipt = { type: 'agent.session.input.tool_result'; turn_id: string; call_id: string; success: boolean; output?: string; error?: string };
interface Session {
  id: string;
  controller: AbortController;
  // Tool calls (`turn_id:call_id`) already executed in this session. A call runs at most once,
  // however often it reappears in required_actions; its receipt is retried until Ampersand
  // accepts it or the session ends.
  handled: Set<string>;
}

// The one Ampersand session this server drives.
//   idle     → no session; the next queued input creates one.
//   creating → a create request is in flight or being retried. `attempt` is stored in the
//              session metadata. Once a create fails in a way that may have succeeded
//              (`ambiguous`), the next try looks for that session before creating another.
//   active   → a live session that receives chat input and tool results. A failed or missing
//              session returns to idle.
//   closed   → shutdown; nothing new starts.
type Lifecycle =
  | { kind: 'idle' }
  | { kind: 'creating'; attempt: string; ambiguous: boolean }
  | { kind: 'active'; session: Session }
  | { kind: 'closed' };

class ApiError extends Error {
  constructor(readonly status: number, readonly retryMs: number, operation: string) {
    super(`Ampersand ${operation} returned HTTP ${status}`);
  }
}

function inputMessage({ text, ...metadata }: AgentInput) {
  return {
    role: 'user', content: [{ type: 'input_text', text: text.replaceAll('\0', '\uFFFD') }],
    metadata: { ...metadata, source: 'chat', sender_name: metadata.sender_name.replaceAll('\0', '\uFFFD') },
  };
}

async function* readEvents(response: Response) {
  if (!response.body) throw new Error('Ampersand returned an empty event stream');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let delimiter: RegExpExecArray | null;
      while ((delimiter = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, delimiter.index);
        buffer = buffer.slice(delimiter.index + delimiter[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart()).join('\n');
        if (data && data !== '[DONE]') yield JSON.parse(data) as {
          type: string;
          session?: SessionState;
          turn?: { id: string; error?: { code?: string; message?: string } };
        };
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export function createAmpersand(config: AmpersandConfig, tools: AgentTools, log: FastifyBaseLogger) {
  const base = (config.baseUrl ?? 'https://ampersand.humansand.ai/v1').replace(/\/+$/, '');
  const model = config.model ?? 'ampersand-v0.1';
  const { definitions } = tools;
  const toolNames = new Set(definitions.map(tool => tool.name));
  const instructions = readFileSync(new URL('../../ampersand/prompts/ampersand.md', import.meta.url), 'utf8').trimEnd();
  const lifetime = new AbortController();
  const queue: AgentInput[] = [];
  let state: Lifecycle = { kind: 'idle' };
  let delivering = false;
  // Functions rather than inline checks: `state` changes across awaits, which control-flow
  // narrowing does not see.
  const activeSession = () => state.kind === 'active' ? state.session : undefined;
  const current = (active: Session) => state.kind === 'active' && state.session === active;
  const closed = () => state.kind === 'closed';

  async function api(path: string, options: {
    body?: object;
    key?: string;
    method?: string;
    signal?: AbortSignal;
    stream?: boolean;
  } = {}) {
    const response = await fetch(`${base}/agents/sessions${path}`, {
      method: options.method ?? (options.body ? 'POST' : 'GET'),
      headers: {
        Authorization: `Bearer ${config.apiKey}`, 'OpenAI-Beta': 'agents=v1',
        Accept: options.stream ? 'text/event-stream' : 'application/json',
        ...(options.body && { 'Content-Type': 'application/json' }),
        ...(options.key && { 'Idempotency-Key': options.key }),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.any([options.signal ?? lifetime.signal, AbortSignal.timeout(options.stream ? 180_000 : 15_000)]),
    });
    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after');
      const retryMs = Number(response.headers.get('retry-after-ms')) ||
        (retryAfter ? (Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1_000 : Date.parse(retryAfter) - Date.now()) : 0);
      await response.body?.cancel().catch(() => {});
      throw new ApiError(response.status, retryMs || 0, options.method ?? (options.body ? 'POST' : 'GET'));
    }
    return response;
  }

  async function wait(error: unknown, attempt: number, signal: AbortSignal) {
    const backoff = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6));
    const retryMs = error instanceof ApiError ? error.retryMs : 0;
    await delay(Math.max(backoff, retryMs), undefined, { signal, ref: false }).catch(() => {});
  }

  const path = (id: string) => `/${encodeURIComponent(id)}`;

  async function saved(active: Session) {
    return await (await api(path(active.id), { signal: active.controller.signal })).json() as SessionState;
  }

  async function find(attempt: string, signal?: AbortSignal) {
    const page = await (await api('?limit=100&order=desc', { signal })).json() as { data: SessionState[] };
    return page.data.find(item => item.metadata?.incident_pal_creation === attempt);
  }

  async function remove(id: string, signal?: AbortSignal) {
    await api(path(id), { method: 'DELETE', signal }).catch(() => {});
  }

  async function transcript(after?: string, sessionId?: string): Promise<AmpersandTranscript> {
    const active = activeSession();
    const changed = () => Object.assign(new Error('The session changed. Refresh the transcript.'), { statusCode: 409 });
    if (after && (!active || active.id !== sessionId)) throw changed();
    const result: AmpersandTranscript = {
      sessionId: active?.id ?? null, instructions, model, usage: null, items: [], nextCursor: null,
    };
    if (!active) return result;

    const params = new URLSearchParams({ limit: '25', order: 'desc' });
    if (after) params.set('after', after);
    try {
      const [snapshot, page] = await Promise.all([
        saved(active),
        api(`${path(active.id)}/items?${params}`, { signal: active.controller.signal }).then(async response =>
          await response.json() as { data: AmpersandTranscript['items']; has_more: boolean; last_id: string | null }),
      ]);
      result.items = page.data;
      result.nextCursor = page.has_more ? page.last_id : null;
      if (snapshot.usage) {
        const { input_tokens: inputTokens, output_tokens: outputTokens, input_tokens_details } = snapshot.usage;
        const cached = input_tokens_details?.cached_tokens;
        // https://ampersand.humansand.ai/docs/PRICING.html
        const estimatedCostUsd = cached !== undefined && ['ampersand-v0.1', 'ampersand-tutor-v0.1'].includes(model)
          ? (inputTokens - cached + cached * 0.20 + outputTokens * 5.20) / 1_000_000
          : null;
        result.usage = { inputTokens, outputTokens, estimatedCostUsd };
      }
    } catch (error) {
      if (!current(active)) throw changed();
      if (error instanceof ApiError && error.status === 404) {
        throw Object.assign(new Error('Ampersand could not find the active session.'), { statusCode: 502 });
      }
      throw Object.assign(new Error('Could not load the transcript from Ampersand.'), { statusCode: 502 });
    }
    if (!current(active)) throw changed();
    return result;
  }

  async function submit(active: Session, event: object, key: string) {
    await api(`${path(active.id)}/events`, {
      body: { events: [event] }, key, signal: active.controller.signal,
    });
  }

  // active → idle. The next queued input creates a fresh session.
  function end(active: Session) {
    if (!current(active)) return;
    active.controller.abort();
    state = { kind: 'idle' };
    void deliver();
    void remove(active.id);
  }

  async function sendReceipt(active: Session, action: Action, key: string, receipt: Receipt) {
    const { signal } = active.controller;
    for (let attempt = 0; !signal.aborted; attempt++) {
      try {
        await submit(active, receipt, `tool:${key}`);
        return;
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) return end(active);
        if (error instanceof ApiError && [400, 409].includes(error.status)) {
          const latest = await saved(active).catch(() => undefined);
          if (latest && !latest.required_actions?.some(item => item.turn_id === action.turn_id && item.call_id === action.call_id)) {
            return;
          }
        }
        log.warn({ err: error, tool: action.name }, 'Retrying Ampersand tool receipt');
        await wait(error, attempt, signal);
      }
    }
  }

  function handleActions(active: Session, actions: Action[] = []) {
    if (!current(active)) return;
    for (const action of actions) {
      if (!toolNames.has(action.name)) continue;
      const key = `${action.turn_id}:${action.call_id}`;
      if (active.handled.has(key)) continue;
      active.handled.add(key);
      const target = { type: 'agent.session.input.tool_result' as const, turn_id: action.turn_id, call_id: action.call_id };
      let receipt: Receipt;
      try {
        if (action.type !== 'function_call') throw new Error('Only function tools are supported.');
        receipt = { ...target, success: true, output: JSON.stringify(tools.execute(action.name, action.arguments)) };
      } catch (error) {
        receipt = { ...target, success: false, error: error instanceof Error ? error.message : 'Tool failed.' };
      }
      void sendReceipt(active, action, key, receipt);
    }
  }

  function handleState(active: Session, snapshot: SessionState) {
    if (!current(active)) return;
    if (snapshot.status === 'failed') {
      log.warn({ reason: snapshot.error }, 'Ampersand session failed');
      end(active);
    } else handleActions(active, snapshot.required_actions);
  }

  async function watch(active: Session) {
    const { signal } = active.controller;
    for (let attempt = 0; !signal.aborted; attempt++) {
      try {
        const response = await api(`${path(active.id)}/events`, { stream: true, signal });
        // The stream has no replay cursor. Reconcile after opening it so calls
        // issued before or during reconnection are still handled.
        void saved(active).then(snapshot => handleState(active, snapshot)).catch(error => {
          if (error instanceof ApiError && error.status === 404) end(active);
          else if (!signal.aborted) log.warn({ err: error }, 'Could not reconcile Ampersand session');
        });
        for await (const event of readEvents(response)) {
          attempt = 0;
          if (event.session) handleState(active, event.session);
          if (event.type === 'agent.session.turn.failed') {
            log.warn({ turnId: event.turn?.id, failure: event.turn?.error }, 'Ampersand turn failed');
          }
        }
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof ApiError && error.status === 404) return end(active);
        log.warn({ err: error }, 'Reconnecting Ampersand event stream');
        await wait(error, attempt, signal);
        continue;
      }
      await wait(undefined, attempt, signal);
    }
  }

  // idle | creating → creating. Session creation has no idempotency key, so a create whose
  // response was lost is found by its attempt ID before being retried.
  async function create(input: AgentInput) {
    const previous = state.kind === 'creating' ? state : undefined;
    if (previous?.ambiguous) {
      const existing = await find(previous.attempt);
      if (existing) return existing;
    }
    const attempt = previous?.attempt ?? randomUUID();
    state = { kind: 'creating', attempt, ambiguous: previous?.ambiguous ?? false };
    try {
      return await (await api('', { body: {
        agent: {
          model, instructions, tools: definitions,
          ampersand: { compaction: 'auto' },
        },
        environment: { type: 'none' },
        metadata: { incident_pal_creation: attempt },
        input: [inputMessage(input)],
      } })).json() as SessionState;
    } catch (error) {
      if (state.kind === 'creating' && state.attempt === attempt) {
        const rejected = error instanceof ApiError && error.status < 500 && error.status !== 408;
        state = rejected ? { kind: 'idle' } : { kind: 'creating', attempt, ambiguous: true };
      }
      throw error;
    }
  }

  async function deliver() {
    if (delivering) return;
    delivering = true;
    try {
      for (let attempt = 0; queue.length && !closed();) {
        const input = queue[0];
        const active = activeSession();
        try {
          if (!active) {
            const created = await create(input);
            if (closed()) {
              void remove(created.id, AbortSignal.timeout(2_000));
              return;
            }
            const session: Session = { id: created.id, controller: new AbortController(), handled: new Set() };
            state = { kind: 'active', session };
            queue.shift();
            handleState(session, created);
            if (current(session)) void watch(session);
          } else {
            await submit(active, { type: 'agent.session.input.message', input: [inputMessage(input)] }, `input:${input.id}`);
            if (!current(active)) continue;
            queue.shift();
          }
          attempt = 0;
        } catch (error) {
          if (closed()) return;
          if (active && !current(active)) continue;
          if (active && error instanceof ApiError && error.status === 404) {
            end(active);
            continue;
          }
          log.warn({ err: error, inputId: input.id }, 'Could not deliver Ampersand input');
          if (active && error instanceof ApiError && [400, 413].includes(error.status)) {
            queue.shift();
            continue;
          }
          await wait(error, attempt++, lifetime.signal);
        }
      }
    } finally {
      delivering = false;
    }
  }

  return {
    transcript,
    enqueue(input: AgentInput) {
      queue.push(input);
      void deliver();
    },
    // any → closed. Deletes the live session, or one an interrupted create may have made.
    async close() {
      const previous = state;
      state = { kind: 'closed' };
      lifetime.abort();
      const signal = AbortSignal.timeout(2_000);
      if (previous.kind === 'active') {
        previous.session.controller.abort();
        await remove(previous.session.id, signal);
      } else if (previous.kind === 'creating') {
        const existing = await find(previous.attempt, signal).catch(() => undefined);
        if (existing) await remove(existing.id, signal);
      }
    },
  };
}

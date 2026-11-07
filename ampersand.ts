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
  mode?: 'single' | 'multi';
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
  status: string;
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
  receipts: Map<string, Receipt>;
  pending: Set<string>;
  accepted: Set<string>;
}

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
  const multiAgent = config.mode === 'multi';
  // The hosted multi-agent harness uses send_message for its own coordination.
  const postTool = multiAgent ? 'post_chat_message' : 'send_message';
  const definitions = tools.definitions.map(tool => tool.name === 'send_message' ? { ...tool, name: postTool } : tool);
  const toolNames = new Set(definitions.map(tool => tool.name));
  const instructions = readFileSync(new URL('../prompts/ampersand.md', import.meta.url), 'utf8')
    .trimEnd().replaceAll('{{post_tool}}', postTool);
  const agentInstructions = multiAgent
    ? `${instructions}\n${readFileSync(new URL('../prompts/ampersand-multi.md', import.meta.url), 'utf8').trimEnd()}`
    : instructions;
  const lifetime = new AbortController();
  const queue: AgentInput[] = [];
  let session: Session | undefined;
  let delivering = false;
  let creationAttempt: string | undefined;

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

  async function transcript(after?: string, sessionId?: string): Promise<AmpersandTranscript> {
    const active = session;
    const changed = () => Object.assign(new Error('The session changed. Refresh the transcript.'), { statusCode: 409 });
    if (after && (!active || active.id !== sessionId)) throw changed();
    const result: AmpersandTranscript = {
      sessionId: active?.id ?? null, instructions: agentInstructions, model, multiAgent, usage: null, items: [], nextCursor: null,
    };
    if (!active) return result;

    const params = new URLSearchParams({ limit: '25', order: 'desc' });
    if (after) params.set('after', after);
    try {
      const [state, page] = await Promise.all([
        saved(active),
        api(`${path(active.id)}/items?${params}`, { signal: active.controller.signal }).then(async response =>
          await response.json() as { data: AmpersandTranscript['items']; has_more: boolean; last_id: string | null }),
      ]);
      result.items = page.data;
      result.nextCursor = page.has_more ? page.last_id : null;
      if (state.usage) {
        const { input_tokens: inputTokens, output_tokens: outputTokens, input_tokens_details } = state.usage;
        const cached = input_tokens_details?.cached_tokens;
        // https://ampersand.humansand.ai/docs/PRICING.html
        const estimatedCostUsd = cached !== undefined && ['ampersand-v0.1', 'ampersand-tutor-v0.1'].includes(model)
          ? (inputTokens - cached + cached * 0.20 + outputTokens * 5.20) / 1_000_000
          : null;
        result.usage = { inputTokens, outputTokens, estimatedCostUsd };
      }
    } catch (error) {
      if (session !== active) throw changed();
      if (error instanceof ApiError && error.status === 404) {
        throw Object.assign(new Error('Ampersand could not find the active session.'), { statusCode: 502 });
      }
      throw Object.assign(new Error('Could not load the transcript from Ampersand.'), { statusCode: 502 });
    }
    if (session !== active) throw changed();
    return result;
  }

  async function submit(active: Session, event: object, key: string) {
    await api(`${path(active.id)}/events`, {
      body: { events: [event] }, key, signal: active.controller.signal,
    });
  }

  function replace(active: Session) {
    if (session !== active) return;
    active.controller.abort();
    session = undefined;
    void deliver();
    void api(path(active.id), { method: 'DELETE' }).catch(() => {});
  }

  async function sendReceipt(active: Session, action: Action, key: string, receipt: Receipt) {
    const { signal } = active.controller;
    try {
      for (let attempt = 0; !signal.aborted; attempt++) {
        try {
          await submit(active, receipt, `tool:${key}`);
          active.accepted.add(key);
          return;
        } catch (error) {
          if (signal.aborted) return;
          if (error instanceof ApiError && error.status === 404) return replace(active);
          if (error instanceof ApiError && [400, 409].includes(error.status)) {
            const state = await saved(active).catch(() => undefined);
            if (state && !state.required_actions?.some(item => item.turn_id === action.turn_id && item.call_id === action.call_id)) {
              active.accepted.add(key);
              return;
            }
          }
          log.warn({ err: error, tool: action.name }, 'Retrying Ampersand tool receipt');
          await wait(error, attempt, signal);
        }
      }
    } finally {
      active.pending.delete(key);
    }
  }

  function handleActions(active: Session, actions: Action[] = []) {
    if (session !== active) return;
    for (const action of actions) {
      if (!toolNames.has(action.name)) continue;
      const key = `${action.turn_id}:${action.call_id}`;
      if (active.pending.has(key) || active.accepted.has(key)) continue;
      let receipt = active.receipts.get(key);
      if (!receipt) {
        const target = { type: 'agent.session.input.tool_result' as const, turn_id: action.turn_id, call_id: action.call_id };
        try {
          if (action.type !== 'function_call') throw new Error('Only function tools are supported.');
          const name = action.name === postTool ? 'send_message' : action.name;
          receipt = { ...target, success: true, output: JSON.stringify(tools.execute(name, action.arguments)) };
        } catch (error) {
          receipt = { ...target, success: false, error: error instanceof Error ? error.message : 'Tool failed.' };
        }
        active.receipts.set(key, receipt);
      }
      active.pending.add(key);
      void sendReceipt(active, action, key, receipt);
    }
  }

  function handleState(active: Session, state: SessionState) {
    if (session !== active) return;
    if (state.status === 'failed') {
      log.warn({ reason: state.error }, 'Ampersand session failed');
      replace(active);
    } else handleActions(active, state.required_actions);
  }

  async function watch(active: Session) {
    const { signal } = active.controller;
    for (let attempt = 0; !signal.aborted; attempt++) {
      try {
        const response = await api(`${path(active.id)}/events`, { stream: true, signal });
        // The stream has no replay cursor. Reconcile after opening it so calls
        // issued before or during reconnection are still handled.
        void saved(active).then(state => handleState(active, state)).catch(error => {
          if (error instanceof ApiError && error.status === 404) replace(active);
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
        if (error instanceof ApiError && error.status === 404) return replace(active);
        log.warn({ err: error }, 'Reconnecting Ampersand event stream');
        await wait(error, attempt, signal);
        continue;
      }
      await wait(undefined, attempt, signal);
    }
  }

  async function create(input: AgentInput) {
    if (creationAttempt) {
      // Session creation has no idempotency key. Check for a saved session
      // before retrying a create whose response may have been lost.
      const page = await (await api('?limit=100&order=desc')).json() as { data: SessionState[] };
      const existing = page.data.find(state => state.metadata?.incident_pal_creation === creationAttempt);
      if (existing) return existing;
    }
    creationAttempt ??= randomUUID();
    try {
      return await (await api('', { body: {
        agent: {
          model, instructions: agentInstructions, tools: definitions,
          multi_agent: { enabled: multiAgent },
          ampersand: { compaction: 'auto' },
        },
        environment: { type: 'none' },
        metadata: { incident_pal_creation: creationAttempt },
        input: [inputMessage(input)],
      } })).json() as SessionState;
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.status !== 408) creationAttempt = undefined;
      throw error;
    }
  }

  async function deliver() {
    if (delivering) return;
    delivering = true;
    try {
      for (let attempt = 0; queue.length && !lifetime.signal.aborted;) {
        const input = queue[0];
        const active = session;
        try {
          if (!active) {
            const state = await create(input);
            creationAttempt = undefined;
            if (lifetime.signal.aborted) return;
            session = {
              id: state.id, controller: new AbortController(), receipts: new Map(), pending: new Set(), accepted: new Set(),
            };
            queue.shift();
            handleState(session, state);
            if (session) void watch(session);
          } else {
            await submit(active, { type: 'agent.session.input.message', input: [inputMessage(input)] }, `input:${input.id}`);
            if (session !== active) continue;
            queue.shift();
          }
          attempt = 0;
        } catch (error) {
          if (lifetime.signal.aborted) return;
          if (active && session !== active) continue;
          if (active && error instanceof ApiError && error.status === 404) {
            replace(active);
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
    async close() {
      const active = session;
      session = undefined;
      active?.controller.abort();
      lifetime.abort();
      if (active) await api(path(active.id), { method: 'DELETE', signal: AbortSignal.timeout(2_000) }).catch(() => {});
    },
  };
}

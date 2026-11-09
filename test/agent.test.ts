import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../server.js';
import type { AmpersandTranscript } from '../ampersand/types.js';
import type { ChatSession } from '../messenger/types.js';

type Input = { content: { text: string }[]; metadata: { id: string; channel: string; source: string } };
type Receipt = { success: boolean; output?: string; error?: string };
type Action = { type: 'function_call'; turn_id: string; call_id: string; name: string; arguments: object };

async function until<T>(read: () => T | undefined) {
  const deadline = performance.now() + 4_000;
  while (performance.now() < deadline) {
    const result = read();
    if (result !== undefined) return result;
    await delay(10);
  }
  throw new Error('Timed out waiting for Ampersand transport');
}

async function mockAmpersand() {
  const inputs: Input[] = [];
  let creates = 0;
  const instructions: string[] = [];
  const calls: Action[] = [];
  const actions = new Map<string, Action>();
  const receipts = new Map<string, Receipt>();
  const attempts = new Map<string, string>();
  const streams = new Set<ServerResponse>();
  let sessionId = 'sess_1';
  let callSequence = 0;
  const state = () => ({ id: sessionId, status: 'in_progress', required_actions: [...actions.values()] });
  const emit = (event: object) => {
    for (const stream of streams) stream.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const server = createServer(async (request, response) => {
    const send = (code: number, body?: object) => {
      response.writeHead(code, { 'Content-Type': 'application/json' });
      response.end(body && JSON.stringify(body));
    };
    if (request.headers.authorization !== 'Bearer test-key' || request.headers['openai-beta'] !== 'agents=v1') return send(401);
    const route = request.url;
    if (request.method === 'DELETE') return send(200, { deleted: true });
    if (request.method === 'GET' && route === `/agents/sessions/${sessionId}`) {
      return send(200, {
        ...state(), usage: { input_tokens: 1_000, input_tokens_details: { cached_tokens: 200 }, output_tokens: 200 },
      });
    }
    if (request.method === 'GET' && route?.startsWith(`/agents/sessions/${sessionId}/items?`)) {
      const { searchParams } = new URL(route, 'http://localhost');
      assert.equal(searchParams.get('order'), 'desc');
      if (searchParams.get('after') === 'call-item') {
        return send(200, { data: [{ ...inputs[0], type: 'message', role: 'user' }], last_id: 'input-item', has_more: false });
      }
      const call = calls.at(-1)!;
      const receipt = receipts.get(call.call_id)!;
      return send(200, {
        data: [
          { id: 'result-item', type: 'function_call_output', call_id: call.call_id, output: receipt.output },
          { ...call, id: 'call-item' },
        ],
        last_id: 'call-item', has_more: true,
      });
    }
    if (request.method === 'GET' && route === `/agents/sessions/${sessionId}/events`) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.flushHeaders();
      streams.add(response);
      response.on('close', () => streams.delete(response));
      return;
    }

    let body = '';
    for await (const chunk of request) body += chunk;
    if (request.method === 'POST' && route === '/agents/sessions') {
      const { agent, input } = JSON.parse(body);
      assert.equal(agent.ampersand.compaction, 'auto');
      assert(agent.tools.some((tool: { name: string }) => tool.name === 'post_message'));
      assert(!agent.tools.some((tool: { name: string }) => ['send_message', 'post_chat_message'].includes(tool.name)));
      assert.equal(input.length, 1);
      assert.equal(agent.multi_agent, undefined);
      creates++;
      instructions.push(agent.instructions);
      inputs.push(input[0]);
      return send(200, state());
    }
    if (request.method !== 'POST' || route !== `/agents/sessions/${sessionId}/events`) return send(404);
    const key = String(request.headers['idempotency-key']);
    const [event] = JSON.parse(body).events;
    if (attempts.has(key)) {
      assert.equal(body, attempts.get(key));
      if (event.type === 'agent.session.input.tool_result') actions.delete(event.call_id);
      return send(202);
    }
    attempts.set(key, body);
    if (event.type === 'agent.session.input.message') {
      inputs.push(...event.input);
      // Simulate acceptance followed by a transient failure in the reply.
      if (event.input[0].content[0].text === 'Retry this message') return send(503);
    } else if (event.type === 'agent.session.input.tool_result') {
      receipts.set(event.call_id, event);
      if (event.call_id.startsWith('lost-')) return send(503);
      actions.delete(event.call_id);
    }
    send(202);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`, inputs, instructions, actions,
    creates: () => creates,
    ready: () => until(() => streams.size || undefined),
    call(name: string, args: object, callId = `call-${++callSequence}`, disconnected = false) {
      const action: Action = { type: 'function_call', turn_id: 'turn-1', call_id: callId, name, arguments: args };
      actions.set(callId, action);
      calls.push(action);
      if (disconnected) {
        for (const stream of streams) stream.end();
      } else {
        emit({ type: 'agent.session.requires_action', session: state() });
      }
      return until(() => receipts.get(callId));
    },
    finishTurn() {
      emit({ type: 'agent.session.turn.completed', turn: { id: 'turn-1' } });
    },
    replaceSession() {
      sessionId = 'sess_2';
      for (const stream of streams) stream.end();
    },
    close() {
      for (const stream of streams) stream.end();
      server.close();
      server.closeAllConnections();
    },
  };
}

test('agent wakes on chat, reads payment logs, and posts status updates', async context => {
  const mock = await mockAmpersand();
  const app = buildApp({ simulate: false, ampersand: { apiKey: 'test-key', baseUrl: mock.url } });
  context.after(async () => {
    await app.close();
    mock.close();
  });
  const post = (url: string, payload: object = {}, token?: string) => app.inject({
    method: 'POST', url, payload, headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  const { token } = (await post('/api/chat/participants', { name: 'Responder' })).json<ChatSession>();
  let nonce = 0;
  const chat = (text: string, channel = 'incident-response') =>
    post(`/api/chat/channels/${channel}/messages`, { text, nonce: (++nonce).toString(16).padStart(32, '0') }, token);
  const flags = async () => (await post('/api/tools/get_flags')).json();
  let flow = 0;
  const payment = async (user: number, expectedStatus: number, cartCurrency: string, paymentCurrency?: string) => {
    const flowId = `checkout-${++flow}`;
    const headers = { 'x-sim-user': `shopper-${user}`, 'x-sim-flow': flowId };
    const cart = await app.inject({
      method: 'POST', url: '/shop/cart', payload: { productId: 'field-notebook', currency: cartCurrency }, headers,
    });
    assert.equal(cart.statusCode, 201);
    const checkout = await app.inject({
      method: 'POST', url: '/shop/checkout', payload: { cartId: cart.json().cartId, currency: paymentCurrency }, headers,
    });
    assert.equal(checkout.statusCode, expectedStatus);
    return flowId;
  };
  const setStrict = async (enabled: boolean) => {
    assert.equal((await post('/api/flags', { flag: 'strict_payment_validation', enabled })).statusCode, 200);
  };

  const transcriptUrl = '/api/ampersand/transcript';
  const transcript = async (query = '') => {
    const response = await app.inject({ url: transcriptUrl + query });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    return response.json<AmpersandTranscript>();
  };
  const empty = await transcript();
  assert.equal(empty.sessionId, null);
  assert.equal(empty.usage, null);
  assert.deepEqual(empty.items, []);
  assert.match((await app.inject('/ampersand')).body, /System instructions/);

  await setStrict(true);
  assert.equal((await chat('Hello', 'all-water-cooler')).statusCode, 201);
  await mock.ready();
  assert.equal(mock.creates(), 1);
  assert.equal(mock.inputs[0].content[0].text, 'Hello');
  assert.equal((await chat('Retry this message', 'all-water-cooler')).statusCode, 201);
  await until(() => mock.inputs.find(input => input.content[0].text === 'Retry this message'));
  await chat('Follow-up after retry');
  await until(() => mock.inputs.find(input => input.content[0].text === 'Follow-up after retry'));
  const silent = await mock.call('pass', {}, 'lost-receipt');
  assert.equal(silent.success, true);
  await chat('A new message while a tool is pending', 'eng-core-payments');
  const duringWork = await until(() => mock.inputs.find(input => input.content[0].text === 'A new message while a tool is pending'));
  assert.equal(duringWork.metadata.channel, 'eng-core-payments');
  assert(mock.actions.has('lost-receipt'));
  mock.finishTurn();
  assert.equal((await mock.call('list_channels', {}, 'other-turn-work', true)).success, true);
  assert.equal(mock.inputs.filter(input => input.content[0].text === 'Retry this message').length, 1);

  const failedFlow = await payment(1, 502, 'usd', 'usd');
  await payment(2, 502, 'eur', 'eur');
  await payment(1, 201, 'usd');
  await payment(3, 201, 'USD', 'usd');
  await chat('Please investigate the checkout failures.');
  await until(() => mock.inputs.find(input => input.content[0].text === 'Please investigate the checkout failures.'));
  assert(mock.inputs.every(input => input.metadata.source === 'chat'));
  const paymentLogs = await mock.call('query_logs', { route: '/shop/checkout', level: 'error' });
  assert.equal(paymentLogs.success, true);
  assert.equal(JSON.parse(paymentLogs.output!).entries.length, 2);
  const debug = await transcript();
  assert.equal(debug.sessionId, 'sess_1');
  assert.equal(debug.instructions, mock.instructions[0]);
  assert.deepEqual(debug.usage, { inputTokens: 1_000, outputTokens: 200, estimatedCostUsd: 0.00188 });
  assert.equal(debug.items[0].type, 'function_call_output');
  assert.equal(debug.items[0].call_id, debug.items[1].call_id);
  assert.equal(debug.items[1].name, 'query_logs');
  const older = `?after=${debug.nextCursor}&sessionId=${debug.sessionId}`;
  assert.equal((await transcript(older)).items[0].content?.[0].text, 'Hello');
  const failedTrace = await mock.call('query_logs', { flowId: failedFlow });
  assert.equal(failedTrace.success, true);
  const [payLog, cartLog] = JSON.parse(failedTrace.output!).entries;
  assert.equal(payLog.error.code, 'PAYMENT_PROVIDER_REJECTED');
  assert.equal(payLog.checkout.cartId, cartLog.checkout.cartId);
  assert.equal(payLog.checkout.currency, 'USD');
  assert.equal(cartLog.checkout.currency, 'usd');
  const impact = { channel: 'global-incident-status', text: 'Checkout payments are failing for some shoppers.' };
  assert.equal((await mock.call('post_message', impact, 'lost-public-receipt')).success, true);
  await mock.call('post_message', impact, 'lost-public-receipt');
  await until(() => mock.actions.has('lost-public-receipt') ? undefined : true);

  const update = { flag: 'strict_payment_validation', enabled: false };
  assert.equal((await mock.call('update_flag', update)).success, true);
  const history = (await post('/api/tools/get_flag_history', { flag: update.flag })).json().history;
  assert.equal(history[0].source, 'agent');
  assert.equal(history[0].previousEnabled, true);
  assert.equal(history[0].enabled, false);
  assert.equal((await flags()).flags.find((flag: { id: string }) => flag.id === update.flag).updatedAt, history[0].at);
  const enable = { flag: 'cart_item_details', enabled: true };
  assert.equal((await mock.call('update_flag', enable)).success, true);
  const enabledHistory = (await post('/api/tools/get_flag_history', { flag: enable.flag })).json().history;
  assert.equal(enabledHistory[0].enabled, true);
  assert.equal(enabledHistory[0].source, 'agent');
  await payment(1, 201, 'usd', 'usd');
  await payment(2, 201, 'eur', 'eur');
  const successfulPayments = await mock.call('query_logs', { route: '/shop/checkout', level: 'info' });
  assert.equal(successfulPayments.success, true);
  assert.equal(JSON.parse(successfulPayments.output!).entries.length, 4);
  assert.equal((await mock.call('post_message', {
    channel: 'global-incident-status', text: 'Checkout payments are succeeding again.',
  })).success, true);

  const page = (await post('/api/tools/read_channel', { channel: 'global-incident-status', limit: 1 })).json();
  assert.equal(page.messages[0].author.name, 'Ampersand');
  assert.equal(page.messages[0].text, 'Checkout payments are succeeding again.');
  assert.equal(typeof page.nextBefore, 'number');
  const earlier = (await post('/api/tools/read_channel', {
    channel: 'global-incident-status', before: page.nextBefore, limit: 1,
  })).json();
  assert.equal(earlier.messages[0].text, 'Checkout payments are failing for some shoppers.');
  assert.equal(earlier.nextBefore, null);

  mock.replaceSession();
  await chat('A new message after session loss');
  await until(() => mock.inputs.find(input => input.content[0].text === 'A new message after session loss'));
  assert.equal(mock.creates(), 2);
  assert.equal((await app.inject(transcriptUrl + older)).statusCode, 409);
});

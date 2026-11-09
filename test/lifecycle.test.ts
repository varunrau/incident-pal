import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { test, type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import { Ampersand, type AgentTools } from '../ampersand/agent.js';
import { buildApp } from '../server.js';
import type { ChatSession } from '../messenger/types.js';
import { routeAmpersandTo } from './route-ampersand.js';

async function until<T>(read: () => T | undefined) {
  const deadline = performance.now() + 4_000;
  while (performance.now() < deadline) {
    const result = read();
    if (result !== undefined) return result;
    await delay(10);
  }
  throw new Error('Timed out waiting for Ampersand transport');
}

type Event = { type: string; call_id?: string; success?: boolean; output?: string };

// A minimal Ampersand that records the sessions it creates and the events it receives.
async function mockAmpersand(context: TestContext, { createStatus = 200, requiredActions = [] as object[] } = {}) {
  const sessions: Array<{ id: string; status: string; required_actions: object[] }> = [];
  const deleted: string[] = [];
  const events: Event[] = [];
  const streams = new Set<ServerResponse>();
  const server = createServer(async (request, response) => {
    const send = (code: number, body?: object) => {
      response.writeHead(code, { 'Content-Type': 'application/json' });
      response.end(body && JSON.stringify(body));
    };
    const url = new URL(request.url ?? '/', 'http://localhost');
    const id = url.pathname.split('/')[3];
    if (request.method === 'DELETE') {
      deleted.push(id);
      return send(200, { deleted: true });
    }
    if (request.method === 'GET' && url.pathname.endsWith('/events')) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.flushHeaders();
      streams.add(response);
      response.on('close', () => streams.delete(response));
      return;
    }
    const session = sessions.find(item => item.id === id);
    if (request.method === 'GET' && session) return send(200, session);

    let body = '';
    for await (const chunk of request) body += chunk;
    if (request.method === 'POST' && url.pathname === '/agents/sessions') {
      if (createStatus !== 200) return send(createStatus, { error: { message: 'rejected' } });
      if (!JSON.parse(body).input?.length) return send(400, { error: { message: 'Invalid request fields: input' } });
      const created = { id: `sess_${sessions.length + 1}`, status: 'idle', required_actions: requiredActions };
      sessions.push(created);
      return send(200, created);
    }
    if (request.method === 'POST' && session) {
      events.push(...JSON.parse(body).events);
      return send(202);
    }
    send(404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const restoreFetch = routeAmpersandTo(`http://127.0.0.1:${address.port}`);
  context.after(() => {
    restoreFetch();
    for (const stream of streams) stream.end();
    server.close();
    server.closeAllConnections();
  });
  return { sessions, deleted, events, streams };
}

test('the session is created at startup and receives chat as input events', async context => {
  const mock = await mockAmpersand(context);
  const app = buildApp({ simulate: false, ampersandApiKey: 'test-key' });
  context.after(() => app.close());

  await app.ready();
  assert.equal(mock.sessions.length, 1);
  await until(() => mock.streams.size || undefined);

  const { token } = (await app.inject({ method: 'POST', url: '/api/chat/participants', payload: { name: 'Responder' } })).json<ChatSession>();
  const response = await app.inject({
    method: 'POST', url: '/api/chat/channels/incident-response/messages',
    payload: { text: 'Checkout is failing', nonce: '0'.repeat(32) }, headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 201);
  await until(() => mock.events.length || undefined);
  assert.equal(mock.events[0].type, 'agent.session.input.message');
  assert.equal(mock.sessions.length, 1);
});

test('the server does not start when the session cannot be created', async context => {
  await mockAmpersand(context, { createStatus: 401 });
  const app = buildApp({ simulate: false, ampersandApiKey: 'test-key' });
  context.after(() => app.close());
  await assert.rejects(async () => { await app.ready(); });
});

test('closing the server deletes its session', async context => {
  const mock = await mockAmpersand(context);
  const app = buildApp({ simulate: false, ampersandApiKey: 'test-key' });
  await app.ready();
  await app.close();
  assert.deepEqual(mock.deleted, ['sess_1']);
});

test('tool calls in the same turn run in parallel', async context => {
  const action = (name: string) => ({ type: 'function_call', turn_id: 'turn-1', call_id: name, name, arguments: {} });
  const mock = await mockAmpersand(context, { requiredActions: [action('first'), action('second')] });

  let secondStarted!: () => void;
  const started = new Promise<void>(resolve => { secondStarted = resolve; });
  const parameters = { type: 'object', properties: {} };
  const tools: AgentTools = {
    definitions: ['first', 'second'].map(name => ({ type: 'function', name, description: name, parameters })),
    // `first` finishes only after `second` has begun, so running them in order never finishes.
    async execute(name) {
      if (name === 'first') await started;
      else secondStarted();
      return { name };
    },
  };
  const agent = new Ampersand('test-key', tools, Fastify().log);
  context.after(() => agent.close());
  await agent.start();

  await until(() => mock.events.length === 2 || undefined);
  assert.deepEqual(mock.events.map(event => event.call_id).sort(), ['first', 'second']);
  assert(mock.events.every(event => event.success));
});

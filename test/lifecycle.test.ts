import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../server.js';
import type { ChatSession } from '../messenger/types.js';

async function until<T>(read: () => T | undefined) {
  const deadline = performance.now() + 4_000;
  while (performance.now() < deadline) {
    const result = read();
    if (result !== undefined) return result;
    await delay(10);
  }
  throw new Error('Timed out waiting for Ampersand transport');
}

// A minimal Ampersand that records each session it creates. `onCreate` decides how a create
// request is answered after the session has been saved.
async function mockAmpersand(onCreate: (count: number, response: ServerResponse, session: object) => void) {
  const sessions: Array<{ id: string; status: string; metadata: Record<string, string> }> = [];
  const deleted: string[] = [];
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
    if (request.method === 'GET' && url.pathname === '/agents/sessions') return send(200, { data: sessions });
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
      const created = { id: `sess_${sessions.length + 1}`, status: 'idle', metadata: JSON.parse(body).metadata };
      sessions.push(created);
      return onCreate(sessions.length, response, created);
    }
    send(request.method === 'POST' && session ? 202 : 404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`, sessions, deleted, streams,
    close() {
      for (const stream of streams) stream.end();
      server.close();
      server.closeAllConnections();
    },
  };
}

async function startChat(url: string) {
  const app = buildApp({ simulate: false, ampersand: { apiKey: 'test-key', baseUrl: url } });
  const { token } = (await app.inject({ method: 'POST', url: '/api/chat/participants', payload: { name: 'Responder' } })).json<ChatSession>();
  const response = await app.inject({
    method: 'POST', url: '/api/chat/channels/incident-response/messages',
    payload: { text: 'Checkout is failing', nonce: '0'.repeat(32) }, headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(response.statusCode, 201);
  return app;
}

test('a create whose response is lost is recovered instead of repeated', async context => {
  // The first create succeeds on the server but the client sees a 503.
  const mock = await mockAmpersand((count, response, session) => {
    response.writeHead(count === 1 ? 503 : 200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(session));
  });
  const app = await startChat(mock.url);
  context.after(async () => {
    await app.close();
    mock.close();
  });

  await until(() => mock.streams.size || undefined);
  assert.equal(mock.sessions.length, 1);
  assert.equal((await app.inject('/api/ampersand/transcript')).json().sessionId, 'sess_1');
});

test('closing during a create deletes the session it may have made', async context => {
  // Never answer the create, as if the response is still on its way at shutdown.
  const mock = await mockAmpersand(() => {});
  context.after(() => mock.close());
  const app = await startChat(mock.url);

  await until(() => mock.sessions.length || undefined);
  await app.close();
  assert.deepEqual(mock.deleted, ['sess_1']);
});

import { AMPERSAND_BASE_URL } from '../ampersand/agent.js';

// Sends the agent's requests to a local mock for the duration of a test. The base URL is a
// constant in production, so the redirect happens at the fetch layer. Call this before creating
// the app, because the API client captures `fetch` when it is constructed.
export function routeAmpersandTo(url: string) {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => original(String(input).replace(AMPERSAND_BASE_URL, url), init);
  return () => { globalThis.fetch = original; };
}

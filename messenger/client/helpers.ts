import type { ChatSession } from '../types.js';

const SESSION_KEY = 'incident-pal-chat';

export function randomNonce() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function restoreSession(): ChatSession | undefined {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

export function persistSession(session?: ChatSession) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Chat still works when storage is unavailable.
  }
}

const REQUEST_TIMEOUT_MS = 8_000;

const clock = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
export const time = (ms: number) => clock.format(ms);
export const flagState = (enabled: boolean) => enabled ? 'On' : 'Off';

export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export const isUnauthorized = (failure: unknown) => failure instanceof HttpError && failure.status === 401;
export const errorMessage = (failure: unknown, fallback: string) => failure instanceof Error ? failure.message : fallback;

// Sends a GET, or a JSON POST when `body` is set. Throws an HttpError with the server's message
// when the response is not OK.
export async function request<T>(path: string, { body, token }: { body?: object; token?: string } = {}): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      ...(body && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...(body && { method: 'POST', body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new HttpError(data.message || 'Request failed.', response.status);
  return data;
}

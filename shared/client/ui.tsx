import { StrictMode, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

const POLL_MS = 1_000;
const REQUEST_TIMEOUT_MS = 4_000;

const clock = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
export const time = (ms: number) => clock.format(ms);
export const flagState = (enabled: boolean) => enabled ? 'On' : 'Off';

export async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(path, {
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...(body && {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || 'Request failed');
  return data;
}

// Polls `path` once a second. `dataPath` says which path the current data came from, so a
// caller can tell when it is still showing the previous path's response.
export function usePolled<T>(path: string) {
  const [latest, setLatest] = useState<{ path: string; data: T }>();
  const [connected, setConnected] = useState(true);
  const issued = useRef(0);
  const applied = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++issued.current;
    try {
      const data = await request<T>(path);
      if (id < applied.current) return;
      applied.current = id;
      setLatest({ path, data });
      setConnected(true);
    } catch {
      setConnected(false);
    }
  }, [path]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (active) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [refresh]);

  return { data: latest?.data, dataPath: latest?.path, connected, refresh };
}

const pages = [
  { href: '/', label: 'Dashboard' },
  { href: '/flags', label: 'Feature flags' },
  { href: '/chat', label: 'Chat' },
  { href: '/ampersand', label: 'Ampersand' },
];

export function Masthead({ current }: { current: string }) {
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <div className="brand">
          <img src="/pal.svg" width="26" height="26" alt="" />
          <strong>Incident Pal</strong>
        </div>
        <nav className="app-nav" aria-label="Main">
          {pages.map(({ href, label }) => (
            <a key={href} href={href} aria-current={href === current ? 'page' : undefined}>{label}</a>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function ConnectionLabel({ connected }: { connected: boolean }) {
  return <p className="connection" role="status" hidden={connected}>Reconnecting to the local service…</p>;
}

export function mount(page: ReactNode) {
  const root = document.getElementById('root');
  if (!root) throw new Error('The page has no #root element.');
  createRoot(root).render(<StrictMode>{page}</StrictMode>);
}

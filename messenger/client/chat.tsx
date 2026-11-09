import MarkdownIt from 'markdown-it/browser';
import {
  memo, useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore,
  type FormEvent, type ReactNode, type RefObject,
} from 'react';
import { Masthead, mount } from '../../shared/client/ui.js';
import type { ChatAuthor, ChatChannel, ChatMessage, ChatSession, ChatSnapshot } from '../types.js';

const SESSION_KEY = 'incident-pal-chat';
const AGENT_AUTHOR_ID = 'agent:ampersand';
const FALLBACK_AVATAR = 'pebble-turtle';
const HISTORY_LIMIT = 100;
const STICK_TO_BOTTOM_PX = 48;
const POST_TIMEOUT_MS = 8_000;

const markdown = new MarkdownIt({ html: false, linkify: true }).disable('image');
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fullTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const isExpired = (failure: unknown) => failure instanceof HttpError && failure.status === 401;
const messageOf = (failure: unknown, fallback: string) => failure instanceof Error ? failure.message : fallback;

async function post<T>(path: string, body: object, token?: string): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new HttpError(data.message || 'Request failed.', response.status);
  return data;
}

function restoreSession(): ChatSession | undefined {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

function persistSession(session?: ChatSession) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Chat still works when storage is unavailable.
  }
}

interface ChatState {
  status: 'connecting' | 'open' | 'lost';
  channels: ChatChannel[];
  messages: Record<string, ChatMessage[]>;
}

type ChatAction =
  | { type: 'snapshot'; snapshot: ChatSnapshot }
  | { type: 'channel'; channel: ChatChannel }
  | { type: 'message'; message: ChatMessage }
  | { type: 'lost' };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'snapshot': {
      const messages: ChatState['messages'] = Object.fromEntries(action.snapshot.channels.map(channel => [channel.id, []]));
      for (const message of action.snapshot.messages) messages[message.channel]?.push(message);
      return { status: 'open', channels: action.snapshot.channels, messages };
    }
    case 'channel':
      if (state.messages[action.channel.id]) return state;
      return {
        ...state,
        channels: [...state.channels, action.channel],
        messages: { ...state.messages, [action.channel.id]: [] },
      };
    case 'message': {
      const rows = state.messages[action.message.channel];
      if (!rows) return state;
      return { ...state, messages: { ...state.messages, [action.message.channel]: [...rows, action.message].slice(-HISTORY_LIMIT) } };
    }
    case 'lost':
      return { ...state, status: 'lost' };
  }
}

function useChatStream() {
  const [state, dispatch] = useReducer(chatReducer, { status: 'connecting', channels: [], messages: {} });
  useEffect(() => {
    const events = new EventSource('/api/chat/events');
    events.addEventListener('snapshot', event => dispatch({ type: 'snapshot', snapshot: JSON.parse(event.data) }));
    events.addEventListener('channel', event => dispatch({ type: 'channel', channel: JSON.parse(event.data) }));
    events.addEventListener('message', event => dispatch({ type: 'message', message: JSON.parse(event.data) }));
    events.addEventListener('error', () => dispatch({ type: 'lost' }));
    return () => events.close();
  }, []);
  return [state, dispatch] as const;
}

function subscribeToHash(notify: () => void) {
  window.addEventListener('hashchange', notify);
  return () => window.removeEventListener('hashchange', notify);
}

function Avatar({ author }: { author: ChatAuthor }) {
  const primary = author.id === AGENT_AUTHOR_ID ? '/pal.svg' : `/api/chat/avatars/${encodeURIComponent(author.avatar ?? FALLBACK_AVATAR)}.webp`;
  const fallback = `/api/chat/avatars/${FALLBACK_AVATAR}.webp`;
  const [source, setSource] = useState<string | null>(primary);
  return (
    <span className="chat-avatar" aria-hidden="true">
      {source && <img alt="" src={source} onError={() => setSource(source === fallback ? null : fallback)} />}
    </span>
  );
}

const MessageRow = memo(function MessageRow({ message }: { message: ChatMessage }) {
  return (
    <article className="chat-message">
      <Avatar author={message.author} />
      <div>
        <div className="chat-byline">
          <strong>{message.author.name}</strong>
          <time dateTime={new Date(message.at).toISOString()} title={fullTime.format(message.at)}>{clock.format(message.at)}</time>
        </div>
        {/* markdown-it runs with html disabled, so message text cannot inject markup. */}
        <p dangerouslySetInnerHTML={{ __html: markdown.renderInline(message.text) }} />
      </div>
    </article>
  );
});

function History({ channel, messages, ownId }: { channel?: ChatChannel; messages: ChatMessage[]; ownId?: string }) {
  const element = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  const scrollToBottom = () => {
    if (element.current) element.current.scrollTop = element.current.scrollHeight;
  };
  useLayoutEffect(() => {
    atBottom.current = true;
    scrollToBottom();
  }, [channel?.id]);
  useLayoutEffect(() => {
    if (atBottom.current || messages.at(-1)?.author.id === ownId) scrollToBottom();
  }, [messages, ownId]);

  return (
    <div
      ref={element} className="chat-history" role="log" tabIndex={0}
      aria-label={channel ? `Messages in ${channel.id}` : 'Messages'}
      onScroll={({ currentTarget: { scrollHeight, scrollTop, clientHeight } }) => {
        atBottom.current = scrollHeight - scrollTop - clientHeight < STICK_TO_BOTTOM_PX;
      }}
    >
      {!channel && <p className="chat-empty">Connecting to chat…</p>}
      {channel && !messages.length && <p className="chat-empty">No messages yet.</p>}
      {messages.map(message => <MessageRow key={message.id} message={message} />)}
    </div>
  );
}

function randomNonce() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function Composer({ channel, session, connected, sending, input, onSending, onError, onExpired }: {
  channel?: string;
  session?: ChatSession;
  connected: boolean;
  sending: boolean;
  input: RefObject<HTMLInputElement | null>;
  onSending: (sending: boolean) => void;
  onError: (message: string) => void;
  onExpired: (session: ChatSession) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Reusing a nonce for the same text makes a retry after a lost response safe.
  const attempts = useRef(new Map<string, { text: string; nonce: string }>());
  const draft = channel ? drafts[channel] ?? '' : '';

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!session || !channel || !text || sending) return;
    if (!connected) {
      onError('Wait for chat to reconnect before sending.');
      return;
    }

    let attempt = attempts.current.get(channel);
    if (attempt?.text !== text) {
      attempt = { text, nonce: randomNonce() };
      attempts.current.set(channel, attempt);
    }
    onError('');
    onSending(true);
    try {
      await post<ChatMessage>(`/api/chat/channels/${channel}/messages`, attempt, session.token);
      attempts.current.delete(channel);
      setDrafts(current => current[channel] === draft ? { ...current, [channel]: '' } : current);
    } catch (failure) {
      if (isExpired(failure)) onExpired(session);
      else onError(messageOf(failure, 'Could not send your message.'));
    } finally {
      onSending(false);
    }
  }

  return (
    <form className="chat-composer" hidden={!session} onSubmit={event => void send(event)}>
      <input
        ref={input} id="message-text" type="text" name="message" aria-label="Message" maxLength={2_000}
        enterKeyHint="send" autoComplete="off" value={draft} placeholder={channel ? `Message #${channel}` : undefined}
        onChange={event => { if (channel) setDrafts(current => ({ ...current, [channel]: event.target.value })); }}
      />
    </form>
  );
}

function ChatDialog({ open, busy, labelledBy, onClose, children }: {
  open: boolean;
  busy: boolean;
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  return (
    <dialog
      ref={dialog} className="chat-dialog" aria-labelledby={labelledBy} onClose={onClose}
      onCancel={event => { if (busy) event.preventDefault(); }}
    >
      {children}
    </dialog>
  );
}

function JoinDialog({ open, notice, name, session, onClose, onJoined }: {
  open: boolean;
  notice: string;
  name?: string;
  session?: ChatSession;
  onClose: () => void;
  onJoined: (session: ChatSession) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Runs after ChatDialog has shown the dialog, because child layout effects run first.
  useLayoutEffect(() => {
    if (!open || !input.current) return;
    if (name !== undefined) input.current.value = name;
    input.current.select();
    setError(notice);
  }, [open, notice, name]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const value = input.current?.value.trim();
    if (!value) {
      setError('Enter a display name.');
      input.current?.focus();
      return;
    }
    setError('');
    setBusy(true);
    try {
      onJoined(await post<ChatSession>('/api/chat/participants', { name: value }, session?.token));
    } catch (failure) {
      setError(messageOf(failure, 'Could not join chat.'));
    } finally {
      setBusy(false);
    }
  }

  const title = session ? 'Change display name' : 'Join chat';
  return (
    <ChatDialog open={open} busy={busy} labelledBy="join-heading" onClose={onClose}>
      <form className="chat-dialog-form" onSubmit={event => void submit(event)}>
        <h2 id="join-heading">{title}</h2>
        <label htmlFor="display-name">Display name</label>
        <input ref={input} id="display-name" name="name" maxLength={40} required autoComplete="off" />
        <p className="error-text" role="status" hidden={!error}>{error}</p>
        <div className="dialog-actions">
          <button type="button" className="text-button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="dialog-submit" disabled={busy}>{session ? 'Save name' : 'Join chat'}</button>
        </div>
      </form>
    </ChatDialog>
  );
}

function ChannelDialog({ open, session, onClose, onCreated, onExpired }: {
  open: boolean;
  session?: ChatSession;
  onClose: () => void;
  onCreated: (channel: ChatChannel) => void;
  onExpired: (session: ChatSession) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    if (!open) return;
    setError('');
    input.current?.focus();
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session || busy || !input.current) return;
    const name = input.current.value.trim();
    if (!name) {
      setError('Enter a channel name.');
      input.current.focus();
      return;
    }
    setError('');
    setBusy(true);
    try {
      const channel = await post<ChatChannel>('/api/chat/channels', { name }, session.token);
      input.current.value = '';
      onCreated(channel);
    } catch (failure) {
      if (isExpired(failure)) onExpired(session);
      else setError(messageOf(failure, 'Could not create the channel.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ChatDialog open={open} busy={busy} labelledBy="new-channel-heading" onClose={onClose}>
      <form className="chat-dialog-form" onSubmit={event => void submit(event)}>
        <h2 id="new-channel-heading">New channel</h2>
        <label htmlFor="channel-input">Channel name</label>
        <input ref={input} id="channel-input" name="name" maxLength={60} required autoComplete="off" />
        <p className="error-text" role="status" hidden={!error}>{error}</p>
        <div className="dialog-actions">
          <button type="button" className="text-button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="dialog-submit" disabled={busy}>Create channel</button>
        </div>
      </form>
    </ChatDialog>
  );
}

function ChatPage() {
  const [{ status, channels, messages }, dispatch] = useChatStream();
  const hash = useSyncExternalStore(subscribeToHash, () => location.hash);
  const [session, setSession] = useState(restoreSession);
  const [join, setJoin] = useState<{ open: boolean; notice: string; name?: string }>({ open: !session, notice: '' });
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [focusRequests, setFocusRequests] = useState(0);
  const composerInput = useRef<HTMLInputElement>(null);

  const active = channels.find(channel => hash === `#${channel.id}`) ?? channels[0];

  useEffect(() => setError(''), [active?.id]);
  // Runs after the render that reveals the composer and closes the dialog.
  useEffect(() => {
    if (focusRequests) composerInput.current?.focus();
  }, [focusRequests]);

  const saveSession = useCallback((value?: ChatSession) => {
    persistSession(value);
    setSession(value);
  }, []);

  const expire = useCallback((expired: ChatSession, action: string) => {
    saveSession();
    setCreatingChannel(false);
    setJoin({ open: true, notice: `Your chat session expired. Join again to ${action}.`, name: expired.author.name });
  }, [saveSession]);

  return <>
    <Masthead current="/chat" />
    <main className="chat-workspace">
      <aside className="channel-rail">
        <div className="channel-navigation">
          <div className="channel-toolbar">
            <h2 id="channel-list-heading">Channels</h2>
            <select
              id="channel-picker" aria-label="Channel" disabled={!channels.length} value={active?.id ?? ''}
              onChange={event => { location.hash = event.target.value; }}
            >
              {!channels.length && <option value="">Connecting…</option>}
              {channels.map(channel => <option key={channel.id} value={channel.id}># {channel.id}</option>)}
            </select>
            <button
              type="button" className="new-channel" aria-label="New channel" title="New channel" disabled={!session}
              onClick={() => setCreatingChannel(true)}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
          </div>
          <nav id="channel-list" aria-labelledby="channel-list-heading">
            {channels.map(channel => (
              <a key={channel.id} href={`#${channel.id}`} aria-current={channel.id === active?.id ? 'true' : undefined}>{`#  ${channel.id}`}</a>
            ))}
          </nav>
        </div>
        <div className="chat-identity">
          <span id="chat-author" hidden={!session}>
            {session && <><Avatar key={session.author.id} author={session.author} />{session.author.name}</>}
          </span>
          <button
            type="button" className="text-button" disabled={sending}
            onClick={() => setJoin({ open: true, notice: '', name: session?.author.name })}
          >{session ? 'Change' : 'Join chat'}</button>
        </div>
      </aside>
      <section className="conversation" aria-labelledby="channel-name">
        <header className="channel-header">
          <h1 id="channel-name">{active ? `# ${active.id}` : 'Chat'}</h1>
          <p hidden={!active?.topic}>{active?.topic}</p>
        </header>
        <History channel={active} messages={(active && messages[active.id]) ?? []} ownId={session?.author.id} />
        <p className="chat-notice" role="status" hidden={status !== 'lost'}>Reconnecting to chat…</p>
        <p className="chat-notice error-text" role="status" hidden={!error}>{error}</p>
        <Composer
          channel={active?.id} session={session} connected={status === 'open'} sending={sending} input={composerInput}
          onSending={setSending} onError={setError} onExpired={expired => expire(expired, 'send your message')}
        />
      </section>
    </main>
    <JoinDialog
      {...join} session={session}
      onClose={() => setJoin(current => ({ ...current, open: false }))}
      onJoined={joined => {
        saveSession(joined);
        setJoin(current => ({ ...current, open: false }));
        setFocusRequests(count => count + 1);
      }}
    />
    <ChannelDialog
      open={creatingChannel} session={session} onClose={() => setCreatingChannel(false)}
      onExpired={expired => expire(expired, 'create a channel')}
      onCreated={channel => {
        dispatch({ type: 'channel', channel });
        setCreatingChannel(false);
        location.hash = `#${channel.id}`;
        setFocusRequests(count => count + 1);
      }}
    />
  </>;
}

mount(<ChatPage />);

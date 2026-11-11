import MarkdownIt from 'markdown-it/browser';
import {
  createContext, Fragment, memo, useContext, useEffect, useLayoutEffect, useReducer, useRef, useState,
  useSyncExternalStore, type FormEvent, type ReactNode, type RefObject,
} from 'react';
import { flagLabel } from '../../payments/types.js';
import { Masthead, mount } from '../../shared/client/ui.js';
import type { ApprovalDecision, ChatApproval, ChatAuthor, ChatChannel, ChatMessage, ChatSnapshot, ChatThinking } from '../types.js';
import { useChatPage, type ChatDialog as ChatDialogState } from './use_chat_page.js';
import { useUnread } from './use_unread.js';

const FALLBACK_AVATAR = '/api/chat/avatars/pebble-turtle.webp';
const HISTORY_LIMIT = 100;
const STICK_TO_BOTTOM_PX = 48;

// html is disabled, so message text cannot inject markup when rendered with dangerouslySetInnerHTML.
const markdown = new MarkdownIt({ html: false, linkify: true }).disable('image');
const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const fullTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const relativeDay = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const startOfDay = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);

// "Today", "Yesterday", or the weekday and date for older messages.
function dayLabel(ms: number) {
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / 86_400_000);
  const label = days < 2 ? relativeDay.format(-days, 'day') : weekday.format(ms);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

interface ChatState {
  status: 'connecting' | 'open' | 'lost';
  channels: ChatChannel[];
  messages: Record<string, ChatMessage[]>;
  // Channels where Ampersand is working on a reply.
  thinking: string[];
}

type ChatAction =
  | { type: 'snapshot'; snapshot: ChatSnapshot }
  | { type: 'channel'; channel: ChatChannel }
  | { type: 'message'; message: ChatMessage }
  | { type: 'message_updated'; message: ChatMessage }
  | { type: 'thinking'; update: ChatThinking }
  | { type: 'lost' };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'snapshot': {
      const messages: ChatState['messages'] = Object.fromEntries(action.snapshot.channels.map(channel => [channel.id, []]));
      for (const message of action.snapshot.messages) messages[message.channel]?.push(message);
      return { status: 'open', channels: action.snapshot.channels, messages, thinking: action.snapshot.thinking };
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
    case 'message_updated': {
      const rows = state.messages[action.message.channel];
      if (!rows?.some(row => row.id === action.message.id)) return state;
      const updated = rows.map(row => row.id === action.message.id ? action.message : row);
      return { ...state, messages: { ...state.messages, [action.message.channel]: updated } };
    }
    case 'thinking': {
      const { channel, thinking } = action.update;
      const others = state.thinking.filter(id => id !== channel);
      return { ...state, thinking: thinking ? [...others, channel] : others };
    }
    case 'lost':
      return { ...state, status: 'lost' };
  }
}

function useChatStream() {
  const [state, dispatch] = useReducer(chatReducer, { status: 'connecting', channels: [], messages: {}, thinking: [] });
  useEffect(() => {
    const events = new EventSource('/api/chat/events');
    events.addEventListener('snapshot', event => dispatch({ type: 'snapshot', snapshot: JSON.parse(event.data) }));
    events.addEventListener('channel', event => dispatch({ type: 'channel', channel: JSON.parse(event.data) }));
    events.addEventListener('message', event => dispatch({ type: 'message', message: JSON.parse(event.data) }));
    events.addEventListener('message_updated', event => dispatch({ type: 'message_updated', message: JSON.parse(event.data) }));
    events.addEventListener('thinking', event => dispatch({ type: 'thinking', update: JSON.parse(event.data) }));
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
  const [source, setSource] = useState<string | null>(author.avatar);
  return (
    <span className="chat-avatar" aria-hidden="true">
      {source && <img alt="" src={source} onError={() => setSource(source === FALLBACK_AVATAR ? null : FALLBACK_AVATAR)} />}
    </span>
  );
}

// Lets approval cards decide without passing a changing callback through the memoized rows.
const ApprovalContext = createContext<{ ownId?: string; decide?: (id: string, decision: ApprovalDecision) => Promise<void> }>({});

function ApprovalCard({ approval }: { approval: ChatApproval }) {
  const { ownId, decide } = useContext(ApprovalContext);
  const names = approval.approvers.map(approver => approver.name).join(', ');
  const canDecide = Boolean(decide) && approval.approvers.some(approver => approver.id === ownId);
  const [busy, setBusy] = useState(false);
  const { flag, enabled } = approval.action;

  async function choose(decision: ApprovalDecision) {
    if (!decide || !canDecide) return;
    setBusy(true);
    try {
      await decide(approval.id, decision);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`approval-card ${approval.status}`} role="group" aria-label="Approval request">
      <p className="approval-action">Turn <strong>{flagLabel(flag)}</strong> {enabled ? 'on' : 'off'}</p>
      {approval.status === 'pending' ? (
        <div className="approval-buttons">
          {canDecide ? <>
            <button type="button" className="approve" disabled={busy} onClick={() => void choose('approve')}>Approve</button>
            <button type="button" className="reject" disabled={busy} onClick={() => void choose('reject')}>Reject</button>
          </> : <span>Waiting on {names}.</span>}
        </div>
      ) : (
        <p className="approval-outcome">
          <strong>{approval.status === 'approved' ? 'Approved' : 'Rejected'}</strong>
          {approval.decidedBy && ` by ${approval.decidedBy.name}`}
          {approval.decidedAt && <> at <time dateTime={new Date(approval.decidedAt).toISOString()}>{clock.format(approval.decidedAt)}</time></>}
        </p>
      )}
    </div>
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
        <p dangerouslySetInnerHTML={{ __html: markdown.renderInline(message.text) }} />
        {message.approval && <ApprovalCard approval={message.approval} />}
      </div>
    </article>
  );
});

function History({ channel, messages, ownId, thinking }: { channel?: ChatChannel; messages: ChatMessage[]; ownId?: string; thinking: boolean }) {
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
  // The thinking indicator changes the history's height.
  useLayoutEffect(() => {
    if (atBottom.current) scrollToBottom();
  }, [thinking]);

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
      {messages.map((message, index) => (
        <Fragment key={message.id}>
          {startOfDay(message.at) !== startOfDay(messages[index - 1]?.at ?? 0) && (
            <h3 className="chat-day"><span>{dayLabel(message.at)}</span></h3>
          )}
          <MessageRow message={message} />
        </Fragment>
      ))}
    </div>
  );
}

function Composer({ channel, enabled, sending, input, onSend }: {
  channel?: string;
  enabled: boolean;
  sending: boolean;
  input: RefObject<HTMLInputElement | null>;
  onSend: (channel: string, text: string) => Promise<boolean>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = channel ? drafts[channel] ?? '' : '';

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!channel || !text || sending) return;
    if (await onSend(channel, text)) {
      setDrafts(current => current[channel] === draft ? { ...current, [channel]: '' } : current);
    }
  }

  return (
    <form className="chat-composer" hidden={!enabled} onSubmit={event => void submit(event)}>
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

function JoinDialog({ dialog, joined, onClose, onSubmit }: {
  dialog: ChatDialogState;
  joined: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const open = dialog.type === 'join';
  const name = open ? dialog.name : undefined;
  const error = open ? dialog.error : '';
  const busy = open && dialog.busy;

  // Runs after ChatDialog has shown the dialog, because child layout effects run first.
  useLayoutEffect(() => {
    if (!open || !input.current) return;
    input.current.value = name ?? '';
    input.current.select();
  }, [open, name]);
  useEffect(() => {
    if (error) input.current?.focus();
  }, [error]);

  return (
    <ChatDialog open={open} busy={busy} labelledBy="join-heading" onClose={onClose}>
      <form className="chat-dialog-form" onSubmit={event => { event.preventDefault(); onSubmit(input.current?.value.trim() ?? ''); }}>
        <h2 id="join-heading">{joined ? 'Change display name' : 'Join chat'}</h2>
        <label htmlFor="display-name">Display name</label>
        <input ref={input} id="display-name" name="name" maxLength={40} required autoComplete="off" />
        <p className="error-text" role="status" hidden={!error}>{error}</p>
        <div className="dialog-actions">
          <button type="button" className="text-button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="dialog-submit" disabled={busy}>{joined ? 'Save name' : 'Join chat'}</button>
        </div>
      </form>
    </ChatDialog>
  );
}

function ChannelDialog({ dialog, onClose, onSubmit }: {
  dialog: ChatDialogState;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const open = dialog.type === 'new-channel';
  const error = open ? dialog.error : '';
  const busy = open && dialog.busy;

  useLayoutEffect(() => {
    if (!open || !input.current) return;
    input.current.value = '';
    input.current.focus();
  }, [open]);
  useEffect(() => {
    if (error) input.current?.focus();
  }, [error]);

  return (
    <ChatDialog open={open} busy={busy} labelledBy="new-channel-heading" onClose={onClose}>
      <form className="chat-dialog-form" onSubmit={event => { event.preventDefault(); onSubmit(input.current?.value.trim() ?? ''); }}>
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
  const [{ status, channels, messages, thinking }, dispatch] = useChatStream();
  const hash = useSyncExternalStore(subscribeToHash, () => location.hash);
  const page = useChatPage();
  const { session, clearError } = page;
  const composerInput = useRef<HTMLInputElement>(null);

  const approvals = { ownId: session?.author.id, decide: session ? page.decide : undefined };

  const active = channels.find(channel => hash === `#${channel.id}`) ?? channels[0];
  const activeThinking = Boolean(active && thinking.includes(active.id));
  const unread = useUnread(messages, channels.length > 0, active?.id, session?.author.id);

  useEffect(() => clearError(), [active?.id]);
  // Runs after the render that reveals the composer and closes the dialog.
  useEffect(() => {
    if (page.focusComposer) composerInput.current?.focus();
  }, [page.focusComposer]);

  async function addChannel(name: string) {
    const channel = await page.addChannel(name);
    if (!channel) return;
    dispatch({ type: 'channel', channel });
    location.hash = `#${channel.id}`;
  }

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
              {channels.map(channel => <option key={channel.id} value={channel.id}># {channel.id}{unread[channel.id] ? ` (${unread[channel.id]})` : ''}</option>)}
            </select>
            <button
              type="button" className="new-channel" aria-label="New channel" title="New channel" disabled={!session}
              onClick={page.openNewChannel}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
          </div>
          <nav id="channel-list" aria-labelledby="channel-list-heading">
            {channels.map(channel => (
              <a
                key={channel.id} href={`#${channel.id}`} className={unread[channel.id] ? 'unread' : undefined}
                aria-current={channel.id === active?.id ? 'true' : undefined}
                aria-label={unread[channel.id] ? `${channel.id}, ${unread[channel.id]} unread` : undefined}
              >
                <span>{`#  ${channel.id}`}</span>
                {Boolean(unread[channel.id]) && <span className="unread-count" aria-hidden="true">{unread[channel.id]}</span>}
              </a>
            ))}
          </nav>
        </div>
        <div className="chat-identity">
          <span id="chat-author" hidden={!session}>
            {session && <><Avatar key={session.author.id} author={session.author} />{session.author.name}</>}
          </span>
          <button type="button" className="text-button" disabled={page.sending} onClick={page.openJoin}>
            {session ? 'Change' : 'Join chat'}
          </button>
        </div>
      </aside>
      <section className="conversation" aria-labelledby="channel-name">
        <header className="channel-header">
          <h1 id="channel-name">{active ? `# ${active.id}` : 'Chat'}</h1>
          <p hidden={!active?.topic}>{active?.topic}</p>
        </header>
        <ApprovalContext.Provider value={approvals}>
          <History channel={active} messages={(active && messages[active.id]) ?? []} ownId={session?.author.id} thinking={activeThinking} />
        </ApprovalContext.Provider>
        <p className="chat-notice" role="status" hidden={status !== 'lost'}>Reconnecting to chat…</p>
        <p className="chat-notice error-text" role="status" hidden={!page.error}>{page.error}</p>
        <p className="chat-notice chat-thinking" role="status" hidden={!activeThinking}>Ampersand is thinking…</p>
        <Composer
          channel={active?.id} enabled={Boolean(session)} sending={page.sending} input={composerInput}
          onSend={(channel, text) => page.send(channel, text, status === 'open')}
        />
      </section>
    </main>
    <JoinDialog dialog={page.dialog} joined={Boolean(session)} onClose={page.closeDialog} onSubmit={name => void page.join(name)} />
    <ChannelDialog dialog={page.dialog} onClose={page.closeDialog} onSubmit={name => void addChannel(name)} />
  </>;
}

mount(<ChatPage />);

import { useEffect, useReducer } from 'react';
import { errorMessage, isUnauthorized } from '../../shared/client/helpers.js';
import type { ApprovalDecision, ChatChannel, ChatSession } from '../types.js';
import { decideApproval } from './actions/decide_approval.js';
import { createChannel } from './actions/create_channel.js';
import { joinChat } from './actions/join_chat.js';
import { sendMessage } from './actions/send_message.js';
import { persistSession, restoreSession } from './helpers.js';

export type ChatDialog =
  | { type: 'closed' }
  | { type: 'join'; name?: string; error: string; busy: boolean }
  | { type: 'new-channel'; error: string; busy: boolean };

interface ChatPageState {
  session?: ChatSession;
  dialog: ChatDialog;
  sending: boolean;
  error: string;
  // Increments each time the composer should take focus.
  focusComposer: number;
}

type ChatPageEvent =
  | { type: 'open-join' }
  | { type: 'open-new-channel' }
  | { type: 'close-dialog' }
  | { type: 'dialog-busy' }
  | { type: 'dialog-error'; error: string }
  | { type: 'joined'; session: ChatSession }
  | { type: 'channel-created' }
  | { type: 'expired'; action: string }
  | { type: 'send-started' }
  | { type: 'send-finished'; error?: string }
  | { type: 'show-error'; error: string };

const closed: ChatDialog = { type: 'closed' };

function initialState(): ChatPageState {
  const session = restoreSession();
  return {
    session,
    dialog: session ? closed : { type: 'join', error: '', busy: false },
    sending: false,
    error: '',
    focusComposer: 0,
  };
}

function reducer(state: ChatPageState, event: ChatPageEvent): ChatPageState {
  switch (event.type) {
    case 'open-join':
      return { ...state, dialog: { type: 'join', name: state.session?.author.name, error: '', busy: false } };
    case 'open-new-channel':
      return state.session ? { ...state, dialog: { type: 'new-channel', error: '', busy: false } } : state;
    case 'close-dialog':
      return { ...state, dialog: closed };
    case 'dialog-busy':
      return state.dialog.type === 'closed' ? state : { ...state, dialog: { ...state.dialog, busy: true, error: '' } };
    case 'dialog-error':
      return state.dialog.type === 'closed' ? state : { ...state, dialog: { ...state.dialog, busy: false, error: event.error } };
    case 'joined':
      return { ...state, session: event.session, dialog: closed, focusComposer: state.focusComposer + 1 };
    case 'channel-created':
      return { ...state, dialog: closed, focusComposer: state.focusComposer + 1 };
    case 'expired':
      return {
        ...state,
        session: undefined,
        sending: false,
        dialog: {
          type: 'join', name: state.session?.author.name, busy: false,
          error: `Your chat session expired. Join again to ${event.action}.`,
        },
      };
    case 'send-started':
      return { ...state, sending: true, error: '' };
    case 'send-finished':
      return { ...state, sending: false, error: event.error ?? '' };
    case 'show-error':
      return { ...state, error: event.error };
  }
}

// The chat page's session, dialogs, and send state, plus the actions that change them.
export function useChatPage() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const { session, dialog } = state;
  useEffect(() => persistSession(session), [session]);

  async function send(channel: string, text: string, connected: boolean) {
    if (!session || state.sending) return false;
    if (!connected) {
      dispatch({ type: 'show-error', error: 'Wait for chat to reconnect before sending.' });
      return false;
    }
    dispatch({ type: 'send-started' });
    try {
      await sendMessage(channel, text, session.token);
      dispatch({ type: 'send-finished' });
      return true;
    } catch (failure) {
      dispatch(isUnauthorized(failure)
        ? { type: 'expired', action: 'send your message' }
        : { type: 'send-finished', error: errorMessage(failure, 'Could not send your message.') });
      return false;
    }
  }

  async function decide(id: string, decision: ApprovalDecision) {
    if (!session) return;
    dispatch({ type: 'show-error', error: '' });
    try {
      await decideApproval(id, decision, session.token);
    } catch (failure) {
      dispatch(isUnauthorized(failure)
        ? { type: 'expired', action: `${decision} the request` }
        : { type: 'show-error', error: errorMessage(failure, `Could not ${decision} the request.`) });
    }
  }

  async function join(name: string) {
    if (dialog.type !== 'join' || dialog.busy) return;
    if (!name) {
      dispatch({ type: 'dialog-error', error: 'Enter a display name.' });
      return;
    }
    dispatch({ type: 'dialog-busy' });
    try {
      dispatch({ type: 'joined', session: await joinChat(name, session?.token) });
    } catch (failure) {
      dispatch({ type: 'dialog-error', error: errorMessage(failure, 'Could not join chat.') });
    }
  }

  async function addChannel(name: string): Promise<ChatChannel | undefined> {
    if (!session || dialog.type !== 'new-channel' || dialog.busy) return;
    if (!name) {
      dispatch({ type: 'dialog-error', error: 'Enter a channel name.' });
      return;
    }
    dispatch({ type: 'dialog-busy' });
    try {
      const channel = await createChannel(name, session.token);
      dispatch({ type: 'channel-created' });
      return channel;
    } catch (failure) {
      dispatch(isUnauthorized(failure)
        ? { type: 'expired', action: 'create a channel' }
        : { type: 'dialog-error', error: errorMessage(failure, 'Could not create the channel.') });
    }
  }

  return {
    ...state,
    send,
    decide,
    join,
    addChannel,
    openJoin: () => dispatch({ type: 'open-join' }),
    openNewChannel: () => dispatch({ type: 'open-new-channel' }),
    closeDialog: () => dispatch({ type: 'close-dialog' }),
    clearError: () => dispatch({ type: 'show-error', error: '' }),
  };
}

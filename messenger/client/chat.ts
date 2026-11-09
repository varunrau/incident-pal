import MarkdownIt from 'markdown-it/browser';
import type { ChatAuthor, ChatChannel, ChatMessage, ChatSession, ChatSnapshot } from '../types.js';

const markdown = new MarkdownIt({ html: false, linkify: true }).disable('image');

const channelList = document.querySelector<HTMLElement>('#channel-list')!;
const picker = document.querySelector<HTMLSelectElement>('#channel-picker')!;
const channelName = document.querySelector<HTMLElement>('#channel-name')!;
const channelTopic = document.querySelector<HTMLElement>('#channel-topic')!;
const history = document.querySelector<HTMLElement>('#chat-history')!;
const joinDialog = document.querySelector<HTMLDialogElement>('#join-dialog')!;
const joinForm = document.querySelector<HTMLFormElement>('#join-chat')!;
const joinHeading = document.querySelector<HTMLElement>('#join-heading')!;
const joinButton = joinForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const cancelJoin = document.querySelector<HTMLButtonElement>('#cancel-join')!;
const joinError = document.querySelector<HTMLElement>('#join-error')!;
const nameInput = document.querySelector<HTMLInputElement>('#display-name')!;
const composer = document.querySelector<HTMLFormElement>('#compose-message')!;
const messageInput = document.querySelector<HTMLInputElement>('#message-text')!;
const identity = document.querySelector<HTMLElement>('#chat-identity')!;
const authorName = document.querySelector<HTMLElement>('#chat-author')!;
const changeName = document.querySelector<HTMLButtonElement>('#change-name')!;
const error = document.querySelector<HTMLElement>('#chat-error')!;
const connection = document.querySelector<HTMLElement>('#chat-connection')!;
const newChannel = document.querySelector<HTMLButtonElement>('#new-channel')!;
const channelDialog = document.querySelector<HTMLDialogElement>('#channel-dialog')!;
const channelForm = document.querySelector<HTMLFormElement>('#create-channel')!;
const channelInput = document.querySelector<HTMLInputElement>('#channel-input')!;
const channelError = document.querySelector<HTMLElement>('#channel-error')!;
const createButton = channelForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const cancelChannel = document.querySelector<HTMLButtonElement>('#cancel-channel')!;

const sessionKey = 'incident-pal-chat';
const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fullTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const drafts = new Map<string, string>();
const attempts = new Map<string, { text: string; nonce: string }>();
let channels: ChatChannel[] = [];
let messages = new Map<string, ChatMessage[]>();
let activeChannel: ChatChannel | undefined;
let session = restoreSession();
let connected = false;
let sending = false;

function restoreSession(): ChatSession | undefined {
  try {
    return JSON.parse(sessionStorage.getItem(sessionKey) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

function renderIdentity() {
  composer.hidden = !session;
  identity.hidden = false;
  authorName.hidden = !session;
  if (session) authorName.replaceChildren(authorAvatar(session.author), session.author.name);
  else authorName.replaceChildren();
  changeName.textContent = session ? 'Change' : 'Join chat';
  newChannel.disabled = !session;
}

function openJoinDialog(message = '') {
  joinHeading.textContent = session ? 'Change display name' : 'Join chat';
  joinButton.textContent = session ? 'Save name' : 'Join chat';
  nameInput.value = session?.author.name ?? nameInput.value;
  setJoinError(message);
  if (!joinDialog.open) joinDialog.showModal();
  nameInput.select();
}

function setJoinError(message = '') {
  joinError.textContent = message;
  joinError.hidden = !message;
}

function saveSession(value?: ChatSession) {
  session = value;
  try {
    if (value) sessionStorage.setItem(sessionKey, JSON.stringify(value));
    else sessionStorage.removeItem(sessionKey);
  } catch {
    // Chat still works when storage is unavailable.
  }
  renderIdentity();
}

function setError(message = '') {
  error.textContent = message;
  error.hidden = !message;
}

async function post<T>(path: string, body: object, token?: string): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    signal: AbortSignal.timeout(8_000),
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message || 'Request failed.'), { status: response.status });
  return data;
}

function appendChannelOption(channel: ChatChannel) {
  const link = document.createElement('a');
  link.href = `#${channel.id}`;
  link.dataset.channel = channel.id;
  link.textContent = `#  ${channel.id}`;
  channelList.append(link);
  picker.add(new Option(`# ${channel.id}`, channel.id));
}

function addChannel(channel: ChatChannel) {
  if (messages.has(channel.id)) return;
  channels.push(channel);
  messages.set(channel.id, []);
  appendChannelOption(channel);
}

function authorAvatar(author: ChatAuthor) {
  const avatar = document.createElement('span');
  avatar.className = 'chat-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  const fallback = 'pebble-turtle';
  const portrait = author.avatar ?? fallback;
  const image = document.createElement('img');
  image.alt = '';
  image.addEventListener('error', () => {
    if (image.src.endsWith(`/${fallback}.webp`)) image.remove();
    else image.src = `/api/chat/avatars/${fallback}.webp`;
  });
  image.src = author.id === 'agent:ampersand' ? '/pal.svg' : `/api/chat/avatars/${encodeURIComponent(portrait)}.webp`;
  avatar.append(image);
  return avatar;
}

function messageRow(message: ChatMessage) {
  const row = document.createElement('article');
  row.className = 'chat-message';
  const content = document.createElement('div');
  const byline = document.createElement('div');
  byline.className = 'chat-byline';
  const author = document.createElement('strong');
  author.textContent = message.author.name;
  const timestamp = document.createElement('time');
  timestamp.dateTime = new Date(message.at).toISOString();
  timestamp.textContent = time.format(message.at);
  timestamp.title = fullTime.format(message.at);
  const text = document.createElement('p');
  text.innerHTML = markdown.renderInline(message.text);
  byline.append(author, timestamp);
  content.append(byline, text);
  row.append(authorAvatar(message.author), content);
  return row;
}

function renderChannel() {
  const channel = channels.find(item => location.hash === `#${item.id}`) ?? channels[0];
  if (!channel) return;
  activeChannel = channel;
  for (const link of channelList.querySelectorAll('a')) {
    if (link.dataset.channel === channel.id) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }
  picker.value = channel.id;
  channelName.textContent = `# ${channel.id}`;
  channelTopic.textContent = channel.topic;
  channelTopic.hidden = !channel.topic;
  history.setAttribute('aria-label', `Messages in ${channel.id}`);
  const rows = (messages.get(channel.id) ?? []).map(messageRow);
  if (rows.length) history.replaceChildren(...rows);
  else {
    const empty = document.createElement('p');
    empty.className = 'chat-empty';
    empty.textContent = 'No messages yet.';
    history.replaceChildren(empty);
  }
  history.scrollTop = history.scrollHeight;
  messageInput.value = drafts.get(channel.id) ?? '';
  messageInput.placeholder = `Message #${channel.id}`;
  setError();
}

joinForm.addEventListener('submit', async event => {
  event.preventDefault();
  const name = nameInput.value.trim();
  if (joinButton.disabled) return;
  if (!name) {
    setJoinError('Enter a display name.');
    nameInput.focus();
    return;
  }
  setJoinError();
  joinButton.disabled = true;
  cancelJoin.disabled = true;
  try {
    saveSession(await post<ChatSession>('/api/chat/participants', { name }, session?.token));
    joinDialog.close();
    messageInput.focus();
  } catch (failure) {
    setJoinError(failure instanceof Error ? failure.message : 'Could not join chat.');
  } finally {
    joinButton.disabled = false;
    cancelJoin.disabled = false;
  }
});

changeName.addEventListener('click', () => {
  if (!sending) openJoinDialog();
});
cancelJoin.addEventListener('click', () => joinDialog.close());
joinDialog.addEventListener('cancel', event => {
  if (joinButton.disabled) event.preventDefault();
});

function setChannelError(message = '') {
  channelError.textContent = message;
  channelError.hidden = !message;
}

newChannel.addEventListener('click', () => {
  setChannelError();
  channelDialog.showModal();
});
cancelChannel.addEventListener('click', () => channelDialog.close());
channelDialog.addEventListener('cancel', event => {
  if (createButton.disabled) event.preventDefault();
});

channelForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!session || createButton.disabled) return;
  const name = channelInput.value.trim();
  if (!name) {
    setChannelError('Enter a channel name.');
    channelInput.focus();
    return;
  }
  setChannelError();
  createButton.disabled = true;
  cancelChannel.disabled = true;
  try {
    const channel = await post<ChatChannel>('/api/chat/channels', { name }, session.token);
    addChannel(channel);
    channelInput.value = '';
    channelDialog.close();
    const hash = `#${channel.id}`;
    if (location.hash === hash) renderChannel();
    else location.hash = hash;
    messageInput.focus();
  } catch (failure) {
    if (failure instanceof Error && 'status' in failure && failure.status === 401) {
      channelDialog.close();
      nameInput.value = session.author.name;
      saveSession();
      openJoinDialog('Your chat session expired. Join again to create a channel.');
    } else {
      setChannelError(failure instanceof Error ? failure.message : 'Could not create the channel.');
    }
  } finally {
    createButton.disabled = false;
    cancelChannel.disabled = false;
  }
});

messageInput.addEventListener('input', () => {
  if (activeChannel) drafts.set(activeChannel.id, messageInput.value);
});

composer.addEventListener('submit', async event => {
  event.preventDefault();
  const channel = activeChannel?.id;
  const draft = messageInput.value;
  const text = draft.trim();
  if (!session || !channel || !text || sending) return;
  if (!connected) {
    setError('Wait for chat to reconnect before sending.');
    return;
  }

  let attempt = attempts.get(channel);
  if (attempt?.text !== text) {
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
    attempt = { text, nonce };
    attempts.set(channel, attempt);
  }
  setError();
  sending = true;
  changeName.disabled = true;
  try {
    await post<ChatMessage>(`/api/chat/channels/${channel}/messages`, attempt, session.token);
    attempts.delete(channel);
    if (drafts.get(channel) === draft) {
      drafts.delete(channel);
      if (activeChannel?.id === channel) messageInput.value = '';
    }
  } catch (failure) {
    if (failure instanceof Error && 'status' in failure && failure.status === 401) {
      nameInput.value = session.author.name;
      saveSession();
      openJoinDialog('Your chat session expired. Join again to send your message.');
    } else {
      setError(failure instanceof Error ? failure.message : 'Could not send your message.');
    }
  } finally {
    sending = false;
    changeName.disabled = false;
  }
});

picker.addEventListener('change', () => { location.hash = picker.value; });
window.addEventListener('hashchange', renderChannel);
renderIdentity();
if (!session) openJoinDialog();

const events = new EventSource('/api/chat/events');
events.addEventListener('snapshot', event => {
  const snapshot: ChatSnapshot = JSON.parse(event.data);
  connected = true;
  connection.hidden = true;
  channels = snapshot.channels;
  messages = new Map(channels.map(channel => [channel.id, []]));
  for (const message of snapshot.messages) messages.get(message.channel)?.push(message);
  channelList.replaceChildren();
  picker.replaceChildren();
  for (const channel of channels) appendChannelOption(channel);
  picker.disabled = false;
  renderChannel();
});
events.addEventListener('channel', event => {
  const channel: ChatChannel = JSON.parse(event.data);
  addChannel(channel);
});
events.addEventListener('message', event => {
  const message: ChatMessage = JSON.parse(event.data);
  const rows = messages.get(message.channel);
  if (!rows) return;
  rows.push(message);
  if (rows.length > 100) rows.shift();
  if (activeChannel?.id !== message.channel) return;
  const atBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 48;
  history.querySelector('.chat-empty')?.remove();
  history.append(messageRow(message));
  if (history.childElementCount > rows.length) history.firstElementChild?.remove();
  if (atBottom || message.author.id === session?.author.id) history.scrollTop = history.scrollHeight;
});
events.addEventListener('error', () => {
  connected = false;
  connection.hidden = false;
});

import type { AmpersandTranscript, AmpersandTranscriptItem } from '../types.js';
import { $, request, setText } from './ui.js';

const refresh = $<HTMLButtonElement>('transcript-refresh');
const older = $<HTMLButtonElement>('transcript-older');
const list = $('transcript-items');
const status = $('transcript-status');
const integer = new Intl.NumberFormat();
const usd = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 6 });
let sessionId: string | null = null;
let nextCursor: string | null = null;

function renderItem(item: AmpersandTranscriptItem) {
  const row = document.createElement('li');
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const raw = document.createElement('pre');
  raw.textContent = JSON.stringify(item, null, 2);

  if (item.type === 'message') {
    const byline = document.createElement('strong');
    const speaker = item.role === 'assistant' ? 'Ampersand' : (item.metadata?.sender_name ?? item.role ?? 'Message');
    byline.textContent = [speaker, item.metadata?.channel && `#${item.metadata.channel}`].filter(Boolean).join(' · ');
    const message = document.createElement('p');
    message.textContent = item.content?.map(part => part.text ?? `[${part.type ?? 'content'}]`).join('\n') ?? '';
    row.append(byline, message);
    summary.textContent = 'Raw message';
  } else {
    const label = item.type === 'function_call' ? 'Tool call'
      : item.type === 'function_call_output' ? 'Tool result'
      : item.type ?? 'Transcript item';
    summary.textContent = [label, item.name ?? item.call_id, item.status].filter(Boolean).join(' · ');
  }

  details.append(summary, raw);
  row.append(details);
  return row;
}

async function load(append = false) {
  const params = new URLSearchParams();
  if (append && nextCursor && sessionId) {
    params.set('after', nextCursor);
    params.set('sessionId', sessionId);
  }
  refresh.disabled = older.disabled = true;
  status.classList.remove('error-text');
  status.textContent = append ? 'Loading older items…' : 'Loading transcript…';

  try {
    const query = params.size ? `?${params}` : '';
    const data = await request<AmpersandTranscript>(`/api/ampersand/transcript${query}`);
    sessionId = data.sessionId;
    nextCursor = data.nextCursor;
    setText('transcript-session', [
      data.model, sessionId && `Session ${sessionId}`, data.multiAgent && 'Lead agent transcript · Usage across all agents',
    ].filter(Boolean).join(' · '));
    setText('transcript-input', data.usage ? integer.format(data.usage.inputTokens) : '—');
    setText('transcript-output', data.usage ? integer.format(data.usage.outputTokens) : '—');
    const cost = data.usage?.estimatedCostUsd;
    setText('transcript-cost', cost == null ? '—' : usd.format(cost));
    setText('transcript-instructions', data.instructions);
    $('transcript-system').hidden = false;

    const rows = data.items.toReversed().map(renderItem);
    if (append) list.prepend(...rows);
    else list.replaceChildren(...rows);
    older.hidden = !nextCursor;
    status.textContent = !sessionId ? 'The transcript will appear after the first chat message reaches Ampersand.'
      : list.childElementCount ? '' : 'No transcript items yet.';
  } catch (error) {
    status.classList.add('error-text');
    status.textContent = error instanceof Error ? error.message : 'Could not load the transcript.';
  } finally {
    refresh.disabled = older.disabled = false;
  }
}

refresh.addEventListener('click', () => void load());
older.addEventListener('click', () => void load(true));
void load();

import { useEffect, useState } from 'react';
import type { AmpersandTranscript, AmpersandTranscriptItem } from '../types.js';
import { errorMessage, request } from '../../shared/client/helpers.js';
import { Masthead, mount } from '../../shared/client/ui.js';

const integer = new Intl.NumberFormat();
const usd = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 6 });
const EMPTY = '—';

function summary(item: AmpersandTranscriptItem) {
  switch (item.type) {
    case 'message': return 'Raw message';
    case 'function_call': return ['Tool call', item.name, item.status].join(' · ');
    case 'function_call_output': return ['Tool result', item.callId, item.status].join(' · ');
    case 'other': return item.itemType;
  }
}

function TranscriptRow({ item }: { item: AmpersandTranscriptItem }) {
  return (
    <li>
      {item.type === 'message' && <>
        <strong>
          {[item.role === 'assistant' ? 'Ampersand' : item.senderName ?? item.role, item.channel && `#${item.channel}`].filter(Boolean).join(' · ')}
        </strong>
        <p>{item.text}</p>
      </>}
      <details>
        <summary>{summary(item)}</summary>
        <pre>{JSON.stringify(item.raw, null, 2)}</pre>
      </details>
    </li>
  );
}

function TranscriptPage() {
  const [transcript, setTranscript] = useState<AmpersandTranscript>();
  const [items, setItems] = useState<AmpersandTranscriptItem[]>([]);
  const [status, setStatus] = useState({ text: 'Loading transcript…', error: false });
  const [loading, setLoading] = useState(false);

  async function load(older?: { after: string; sessionId: string }) {
    setLoading(true);
    setStatus({ text: older ? 'Loading older items…' : 'Loading transcript…', error: false });
    try {
      const query = older ? `?${new URLSearchParams(older)}` : '';
      const data = await request<AmpersandTranscript>(`/api/ampersand/transcript${query}`);
      const rows = data.items.toReversed();
      const count = rows.length + (older ? items.length : 0);
      setTranscript(data);
      setItems(current => older ? [...rows, ...current] : rows);
      setStatus({
        text: !data.sessionId ? 'The Ampersand session starts with the first chat message.' : count ? '' : 'No transcript items yet.',
        error: false,
      });
    } catch (error) {
      setStatus({ text: errorMessage(error, 'Could not load the transcript.'), error: true });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const usage = transcript?.usage;
  const cost = usage?.estimatedCostUsd;
  const older = transcript?.nextCursor && transcript.sessionId
    ? { after: transcript.nextCursor, sessionId: transcript.sessionId } : undefined;
  return <>
    <Masthead current="/ampersand" />
    <main className="transcript-page" aria-labelledby="transcript-heading">
      <div className="section-heading">
        <h1 id="transcript-heading">Ampersand transcript</h1>
        <button className="text-button" type="button" disabled={loading} onClick={() => void load()}>Refresh</button>
      </div>
      <p className="transcript-session">
        {transcript && [transcript.model, transcript.sessionId && `Session ${transcript.sessionId}`].filter(Boolean).join(' · ')}
      </p>
      <dl className="counts" aria-label="Session usage">
        <div><dt>Input tokens</dt><dd>{usage ? integer.format(usage.inputTokens) : EMPTY}</dd></div>
        <div><dt>Output tokens</dt><dd>{usage ? integer.format(usage.outputTokens) : EMPTY}</dd></div>
        <div><dt>Estimated cost</dt><dd>{cost == null ? EMPTY : usd.format(cost)}</dd></div>
      </dl>
      {transcript && (
        <details className="transcript-instructions">
          <summary>System instructions</summary>
          <pre>{transcript.instructions}</pre>
        </details>
      )}
      <section aria-labelledby="transcript-items-heading">
        <div className="section-heading">
          <h2 id="transcript-items-heading">Transcript</h2>
          {older && <button className="text-button" type="button" disabled={loading} onClick={() => void load(older)}>Load older items</button>}
        </div>
        <p id="transcript-status" className={status.error ? 'error-text' : undefined} role="status">{status.text}</p>
        <ol className="transcript-items">
          {items.map((item, index) => <TranscriptRow key={item.id ?? `item-${index}`} item={item} />)}
        </ol>
      </section>
    </main>
  </>;
}

mount(<TranscriptPage />);

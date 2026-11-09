import { useState } from 'react';
import type { FlagId, FlagLog, FlagValues } from '../types.js';
import { ConnectionLabel, flagState, Masthead, mount, request, time, usePolled } from '../../shared/client/ui.js';

function FlagsPage() {
  const { data: flags, connected, refresh } = usePolled<FlagLog>('/api/flags');
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState('');

  async function toggle(flag: FlagId) {
    if (pending || !connected || !flags) return;
    setPending(true);
    setFeedback('');
    try {
      await request<FlagValues>('/api/flags', { flag, enabled: !flags.current[flag] });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Flag change failed.');
    } finally {
      await refresh();
      setPending(false);
    }
  }

  const label = (id: FlagId) => flags?.definitions.find(flag => flag.id === id)?.label ?? id;
  return <>
    <Masthead current="/flags" />
    <main className="flags-page" aria-labelledby="flags-heading">
      <h1 id="flags-heading">Feature flags</h1>
      <ConnectionLabel connected={connected} />
      <div className="flags-layout">
        <section className="flag-controls" aria-labelledby="flag-controls-heading">
          <h2 id="flag-controls-heading">Controls</h2>
          <div>
            {!flags && <p>Connecting…</p>}
            {flags?.definitions.map(flag => (
              <div className="flag-row" key={flag.id}>
                <div><strong>{flag.label}</strong><p>{flag.description}</p></div>
                <button
                  className="flag-switch" type="button" role="switch" aria-label={flag.label}
                  aria-checked={flags.current[flag.id]} disabled={pending || !connected} onClick={() => void toggle(flag.id)}
                >
                  <span className="switch-track" aria-hidden="true"></span>
                </button>
              </div>
            ))}
          </div>
          <p className="flag-feedback error-text" role="status" hidden={!feedback}>{feedback}</p>
        </section>
        <section className="flag-history" aria-labelledby="flag-history-heading">
          <h2 id="flag-history-heading">Flag history</h2>
          <ol>
            {!flags && <li>Loading history…</li>}
            {flags && !flags.history.length && <li>No flag changes yet.</li>}
            {flags?.history.map(event => (
              <li key={`${event.flag}-${event.at}`}>
                <strong>{label(event.flag)}</strong> · {flagState(event.enabled)}
                {' '}<span className="numeric">{time(event.at)} · {event.source}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  </>;
}

mount(<FlagsPage />);

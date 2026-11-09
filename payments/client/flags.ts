import type { FlagId, FlagLog, FlagSnapshot } from '../types.js';
import { $, escape, flagState, request, setText, time } from '../../shared/client/ui.js';

let currentFlags: FlagLog | undefined;
let flagPending = false;
let connected = false;
let refreshInFlight: Promise<void> | undefined;

function syncFlagButtons() {
  for (const button of $('flag-list').querySelectorAll('button')) {
    button.disabled = flagPending || !connected;
  }
}

function renderFlags(flags: FlagLog) {
  const previous = currentFlags;
  currentFlags = flags;
  if (!previous) {
    $('flag-list').innerHTML = flags.definitions.map(flag => `<div class="flag-row">
      <div><strong>${escape(flag.label)}</strong><p>${escape(flag.description)}</p></div>
      <button class="flag-switch" type="button" role="switch" data-flag="${escape(flag.id)}" aria-label="${escape(flag.label)}">
        <span class="switch-track" aria-hidden="true"></span>
      </button>
    </div>`).join('');
  }
  if (previous?.current.id !== flags.current.id || previous.history[0]?.at !== flags.history[0]?.at) {
    for (const button of $('flag-list').querySelectorAll('button')) {
      const enabled = flags.current.values[button.dataset.flag as FlagId];
      button.setAttribute('aria-checked', String(enabled));
    }
    $('flag-history').innerHTML = flags.history.length ? flags.history.map(event =>
      `<li><strong>${escape(flags.definitions.find(flag => flag.id === event.flag)?.label ?? event.flag)}</strong> · ${flagState(event.enabled)}
        <span class="numeric">${time(event.at)} · ${escape(event.source)} · Snapshot #${event.id}</span></li>`).join('')
      : '<li>No flag changes yet.</li>';
  }
  syncFlagButtons();
}

function refresh() {
  refreshInFlight ??= loadFlags().finally(() => { refreshInFlight = undefined; });
  return refreshInFlight;
}

async function loadFlags() {
  try {
    const flags = await request<FlagLog>('/api/flags');
    connected = true;
    $('connection-label').hidden = true;
    renderFlags(flags);
  } catch {
    connected = false;
    setText('connection-label', 'Reconnecting to the local service…');
    $('connection-label').hidden = false;
    syncFlagButtons();
  }
}

function feedback(message: string) {
  setText('flag-feedback', message);
  $('flag-feedback').hidden = !message;
}

async function toggleFlag(flag: FlagId) {
  if (flagPending || !connected || !currentFlags) return;
  const { current } = currentFlags;
  const enabled = !current.values[flag];
  flagPending = true;
  syncFlagButtons();
  feedback('');

  try {
    await request<FlagSnapshot>('/api/flags', { flag, enabled, expectedSnapshotId: current.id });
  } catch (error) {
    feedback(error instanceof Error ? error.message : 'Flag change failed.');
  } finally {
    await refreshInFlight;
    await refresh();
    flagPending = false;
    syncFlagButtons();
  }
}

$('flag-list').addEventListener('click', event => {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-flag]');
  if (button) void toggleFlag(button.dataset.flag as FlagId);
});

refresh();
setInterval(refresh, 1_000);

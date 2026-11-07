import type { Dashboard, FlagLog, Health, RequestLog } from '../types.js';
import { $, escape, flagState, request, setText, time } from './ui.js';

const number = new Intl.NumberFormat();

let level = '';
let flagDefinitions: FlagLog['definitions'] = [];
let connected = false;
let refreshInFlight: Promise<void> | undefined;
let displayedLogs: RequestLog[] = [];
let selected: number | null = null;
let logSignature = '';
let chartSignature = '';
let latestHealth: Health | undefined;

function flagLabel(id: string) {
  return flagDefinitions.find(flag => flag.id === id)?.label ?? id;
}

function renderHealth(health: Health) {
  latestHealth = health;
  const { totals, buckets, start, end, markers } = health;
  setText('log-total', number.format(totals.info + totals.error));
  setText('log-info', number.format(totals.info));
  setText('log-errors', number.format(totals.error));

  const chart = $<SVGSVGElement>('volume-chart');
  const chartWidth = Math.max(280, Math.round(chart.getBoundingClientRect().width));
  const signature = JSON.stringify([chartWidth, buckets, markers]);
  if (signature === chartSignature) return;
  chartSignature = signature;

  const left = 32;
  const right = chartWidth - 3;
  const top = 8;
  const bottom = 108;
  const width = right - left;
  const interval = width / buckets.length;
  const peak = Math.max(4, ...buckets.map(({ info, error }) => info + error));
  const tick = Math.ceil(peak / 4);
  const scale = (bottom - top) / (tick * 4);
  const lines = Array.from({ length: 5 }, (_, i) => {
    const y = bottom - i * tick * scale;
    return `<path d="M${left} ${y}H${right}" class="chart-gridline"/><text x="24" y="${y + 4}" text-anchor="end">${i * tick}</text>`;
  });
  const bars = buckets.map(({ at, info, error }, index) => {
    const x = left + index * interval + interval * 0.23;
    const errorHeight = error * scale;
    const barHeight = (info + error) * scale;
    if (!barHeight) return '';
    const y = bottom - barHeight;
    const barWidth = interval * 0.54;
    const clipId = `volume-bar-${index}`;
    return `<g><title>${time(at)} · ${info} non-error · ${error} error</title>
      <clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="2"/></clipPath>
      <g clip-path="url(#${clipId})">
        <rect class="info" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}"/>
        <rect class="error" x="${x}" y="${y}" width="${barWidth}" height="${errorHeight}"/>
      </g>
    </g>`;
  });
  const position = (at: number) => left + ((at - start) / (end - start)) * width;
  const changes = markers.map(event => {
    const x = position(event.at);
    return `<g><title>${time(event.at)} · ${escape(flagLabel(event.flag))} · ${flagState(event.enabled)}</title><path d="M${x} ${top}V${bottom}" class="chart-marker" stroke-dasharray="4 4"/></g>`;
  });
  const ticks = chartWidth < 430 ? [0, 12, 23] : [0, 6, 12, 18, 23];
  const times = ticks.map(index => {
    const x = index === 23 ? right : left + index * interval;
    return `<text x="${x}" y="125" text-anchor="${index === 23 ? 'end' : 'start'}">${time(buckets[index].at)}</text>`;
  });

  chart.setAttribute('viewBox', `0 0 ${chartWidth} 132`);
  chart.innerHTML = [...lines, ...bars, ...changes, ...times].join('');
  chart.setAttribute('aria-label', `Log volume over the last two minutes: ${totals.info} non-error requests and ${totals.error} error requests.`);
}

function renderLogs() {
  $('inspection').hidden = selected === null;
  const signature = `${level}:${selected}:${displayedLogs.map(log => `${log.sequence}-${log.at}`).join(',')}`;
  if (signature === logSignature) return;
  logSignature = signature;

  const focused = (document.activeElement as HTMLElement | null)?.dataset.request;
  $('log-rows').innerHTML = displayedLogs.length ? displayedLogs.map(log => {
    const expanded = selected === log.sequence;
    const failed = log.level === 'error';
    return `<tr>
      <td>${time(log.at)}</td><td>${escape(log.userId)}</td>
      <td><button type="button" data-request="${log.sequence}" aria-expanded="${expanded}">${escape(log.method)} ${escape(log.path)}</button></td>
      <td class="${failed ? 'error-text' : 'success-text'}">${log.status}</td>
      <td>${log.durationMs} ms</td>
    </tr>${expanded ? `<tr class="log-detail"><td colspan="5"><div class="detail-content">
      <strong class="${failed ? 'error-text' : 'success-text'}">${escape(log.error?.code ?? 'Request succeeded')}</strong>
      <p>${escape(log.error?.message ?? `${log.step} completed with HTTP ${log.status}.`)}</p>
      <small>Request ${escape(log.requestId)} · Flow ${escape(log.flowId)} · ${log.durationMs} ms</small>
      ${log.checkout ? `<small>Cart ${escape(log.checkout.cartId)} · Currency ${escape(log.checkout.currency)}</small>` : ''}
    </div></td></tr>` : ''}`;
  }).join('') : `<tr><td class="empty" colspan="5">${level === 'error' ? 'No error requests yet.' : 'Waiting for requests…'}</td></tr>`;

  if (focused) $('log-rows').querySelector<HTMLButtonElement>(`[data-request="${Number(focused)}"]`)?.focus({ preventScroll: true });
}

function refresh() {
  refreshInFlight ??= loadDashboard().finally(() => { refreshInFlight = undefined; });
  return refreshInFlight;
}

async function loadDashboard() {
  const requestedLevel = level;
  try {
    const query = requestedLevel ? '?level=error' : '';
    const data = await request<Dashboard>(`/api/dashboard${query}`);
    connected = true;
    $('connection-label').hidden = true;
    flagDefinitions = data.flags.definitions;
    renderHealth(data.health);
    if (selected === null && requestedLevel === level) {
      displayedLogs = data.logs;
      renderLogs();
    }
  } catch {
    connected = false;
    setText('connection-label', 'Reconnecting to the local service…');
    $('connection-label').hidden = false;
  }
}

$('log-filters').addEventListener('click', event => {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-level]');
  if (!button || level === button.dataset.level) return;
  level = button.dataset.level ?? '';
  for (const item of $('log-filters').querySelectorAll('button')) {
    item.setAttribute('aria-pressed', String(item === button));
  }
  selected = null;
  displayedLogs = [];
  renderLogs();
  refresh();
});
$('log-rows').addEventListener('click', event => {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-request]');
  if (!button) return;
  const sequence = Number(button.dataset.request);
  selected = selected === sequence ? null : sequence;
  renderLogs();
  if (selected === null) refresh();
});
$('resume-logs').addEventListener('click', () => {
  selected = null;
  renderLogs();
  $('log-filters').querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  refresh();
});

new ResizeObserver(() => {
  if (latestHealth && connected) renderHealth(latestHealth);
}).observe($('volume-chart'));

refresh();
setInterval(refresh, 1_000);

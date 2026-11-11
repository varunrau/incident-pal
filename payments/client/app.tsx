import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import type { Dashboard, FlagLog, Health, Level, RequestLog } from '../types.js';
import { flagState, time } from '../../shared/client/helpers.js';
import { ConnectionLabel, Masthead, mount, usePolled } from '../../shared/client/ui.js';

const number = new Intl.NumberFormat();
const CHART_MIN_WIDTH = 280;
const CHART_NARROW_WIDTH = 430;
const CHART = { left: 32, rightInset: 3, top: 8, bottom: 108, height: 132, axisY: 125, labelX: 24 };
const COLUMN_COUNT = 5;
const GRID_DIVISIONS = 4;

function VolumeChart({ health, definitions }: { health?: Health; definitions: FlagLog['definitions'] }) {
  const svg = useRef<SVGSVGElement>(null);
  const [chartWidth, setChartWidth] = useState(834);

  useLayoutEffect(() => {
    const element = svg.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setChartWidth(Math.max(CHART_MIN_WIDTH, Math.round(element.getBoundingClientRect().width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (!health) return <svg ref={svg} id="volume-chart" viewBox="0 0 834 170" role="img" aria-label="Log volume over the last two minutes" />;

  const { totals, buckets, start, end, markers } = health;
  const { left, top, bottom } = CHART;
  const right = chartWidth - CHART.rightInset;
  const width = right - left;
  const interval = width / buckets.length;
  const peak = Math.max(GRID_DIVISIONS, ...buckets.map(({ info, error }) => info + error));
  const tick = Math.ceil(peak / GRID_DIVISIONS);
  const scale = (bottom - top) / (tick * GRID_DIVISIONS);
  const lastBucket = buckets.length - 1;
  const ticks = chartWidth < CHART_NARROW_WIDTH ? [0, 12, lastBucket] : [0, 6, 12, 18, lastBucket];
  const flagLabel = (id: string) => definitions.find(flag => flag.id === id)?.label ?? id;

  return (
    <svg
      ref={svg} id="volume-chart" viewBox={`0 0 ${chartWidth} ${CHART.height}`} role="img"
      aria-label={`Log volume over the last two minutes: ${totals.info} non-error requests and ${totals.error} error requests.`}
    >
      {Array.from({ length: GRID_DIVISIONS + 1 }, (_, i) => {
        const y = bottom - i * tick * scale;
        return (
          <Fragment key={i}>
            <path d={`M${left} ${y}H${right}`} className="chart-gridline" />
            <text x={CHART.labelX} y={y + 4} textAnchor="end">{i * tick}</text>
          </Fragment>
        );
      })}
      {buckets.map(({ at, info, error }, index) => {
        const barHeight = (info + error) * scale;
        if (!barHeight) return null;
        const x = left + index * interval + interval * 0.23;
        const y = bottom - barHeight;
        const barWidth = interval * 0.54;
        const clipId = `volume-bar-${index}`;
        return (
          <g key={at}>
            <title>{`${time(at)} · ${info} non-error · ${error} error`}</title>
            <clipPath id={clipId}><rect x={x} y={y} width={barWidth} height={barHeight} rx="2" /></clipPath>
            <g clipPath={`url(#${clipId})`}>
              <rect className="info" x={x} y={y} width={barWidth} height={barHeight} />
              <rect className="error" x={x} y={y} width={barWidth} height={error * scale} />
            </g>
          </g>
        );
      })}
      {markers.map(event => {
        const x = left + ((event.at - start) / (end - start)) * width;
        return (
          <g key={`${event.flag}-${event.at}`}>
            <title>{`${time(event.at)} · ${flagLabel(event.flag)} · ${flagState(event.enabled)}`}</title>
            <path d={`M${x} ${top}V${bottom}`} className="chart-marker" strokeDasharray="4 4" />
          </g>
        );
      })}
      {ticks.map(index => {
        const last = index === lastBucket;
        return (
          <text key={index} x={last ? right : left + index * interval} y={CHART.axisY} textAnchor={last ? 'end' : 'start'}>
            {time(buckets[index].at)}
          </text>
        );
      })}
    </svg>
  );
}

function LogRow({ log, expanded, onToggle }: { log: RequestLog; expanded: boolean; onToggle: () => void }) {
  const tone = log.level === 'error' ? 'error-text' : 'success-text';
  return <>
    <tr>
      <td>{time(log.at)}</td>
      <td>{log.userId ?? '—'}</td>
      <td><button type="button" aria-expanded={expanded} onClick={onToggle}>{log.method} {log.route}</button></td>
      <td className={tone}>{log.status}</td>
      <td>{log.durationMs} ms</td>
    </tr>
    {expanded && (
      <tr className="log-detail">
        <td colSpan={COLUMN_COUNT}>
          <div className="detail-content">
            <strong className={tone}>{log.error?.code ?? 'Request succeeded'}</strong>
            <p>{log.error?.message ?? `${log.method} ${log.route} completed with HTTP ${log.status}.`}</p>
            <small>Request {log.requestId} · Flow {log.flowId ?? '—'} · {log.durationMs} ms</small>
            {log.checkout && <small>Cart {log.checkout.cartId} · Currency {log.checkout.currency}</small>}
          </div>
        </td>
      </tr>
    )}
  </>;
}

const filters: { level: Level | ''; label: string }[] = [
  { level: '', label: 'All requests' },
  { level: 'error', label: 'Errors' },
];

function DashboardPage() {
  const [level, setLevel] = useState<Level | ''>('');
  // While a row is open the list stays frozen on the logs that were showing when it was opened.
  const [inspection, setInspection] = useState<{ sequence: number; logs: RequestLog[] } | null>(null);
  const path = level ? '/api/dashboard?level=error' : '/api/dashboard';
  const { data, dataPath, connected } = usePolled<Dashboard>(path);
  const activeFilter = useRef<HTMLButtonElement>(null);
  const liveLogs = dataPath === path && data ? data.logs : [];
  const logs = inspection?.logs ?? liveLogs;

  function toggleRow(sequence: number) {
    setInspection(inspection?.sequence === sequence ? null : { sequence, logs });
  }

  function resume() {
    setInspection(null);
    activeFilter.current?.focus();
  }

  const totals = data?.health.totals;
  return <>
    <Masthead current="/" />
    <main className="dashboard">
      <ConnectionLabel connected={connected} />
      <section className="panel volume-panel" aria-labelledby="volume-heading">
        <div className="section-heading">
          <h1 id="volume-heading">Log volume</h1>
          <span className="window-label">Last 2 minutes</span>
        </div>
        <dl className="counts">
          <div><dt>Total requests</dt><dd>{number.format(totals ? totals.info + totals.error : 0)}</dd></div>
          <div><dt>Non-error requests</dt><dd>{number.format(totals?.info ?? 0)}</dd></div>
          <div><dt>Error requests</dt><dd className="error-text">{number.format(totals?.error ?? 0)}</dd></div>
        </dl>
        <figure className="chart">
          <VolumeChart health={data?.health} definitions={data?.flags.definitions ?? []} />
          <figcaption>
            <div className="legend"><span><i className="key info"></i>Non-error</span><span><i className="key error"></i>Error</span></div>
          </figcaption>
        </figure>
      </section>
      <section className="panel logs-panel" aria-labelledby="logs-heading">
        <div className="section-heading logs-heading">
          <h2 id="logs-heading">Request logs</h2>
          <div className="segments" role="group" aria-label="Filter request logs">
            {filters.map(filter => (
              <button
                key={filter.label} type="button" aria-pressed={filter.level === level}
                ref={filter.level === level ? activeFilter : undefined}
                onClick={() => {
                  if (filter.level === level) return;
                  setLevel(filter.level);
                  setInspection(null);
                }}
              >{filter.label}</button>
            ))}
          </div>
        </div>
        <div className="inspection" hidden={!inspection}>
          <span>Log list paused for inspection</span>
          <button type="button" onClick={resume}>Resume live logs</button>
        </div>
        <div className="table-scroll">
          <table aria-label="Checkout API request logs">
            <colgroup><col className="time-col" /><col className="user-col" /><col className="request-col" /><col className="status-col" /><col /></colgroup>
            <thead><tr><th scope="col">Time</th><th scope="col">User</th><th scope="col">Request</th><th scope="col">Status</th><th scope="col">Duration</th></tr></thead>
            <tbody>
              {logs.map(log => (
                <LogRow key={log.sequence} log={log} expanded={inspection?.sequence === log.sequence} onToggle={() => toggleRow(log.sequence)} />
              ))}
              {!logs.length && <tr><td className="empty" colSpan={COLUMN_COUNT}>{level === 'error' ? 'No error requests yet.' : 'Waiting for requests…'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  </>;
}

mount(<DashboardPage />);

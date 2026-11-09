import {
  flagDefinitions,
  type FlagChange, type FlagId, type FlagLog, type FlagSnapshot, type FlagSource,
  type Health, type LogFilters, type QueryLogs, type RequestLog, type TailLogs,
} from './types.js';

const BUCKET_MS = 5_000;
const BUCKET_COUNT = 24;
const LOG_LIMIT = 10_000;

function matches(log: RequestLog, { level, userId, requestId, flowId, flagSnapshotId, route }: LogFilters) {
  return (!level || log.level === level)
    && (!userId || log.userId === userId)
    && (!requestId || log.requestId === requestId)
    && (!flowId || log.flowId === flowId)
    && (flagSnapshotId === undefined || log.flags.id === flagSnapshotId)
    && (!route || log.route === route);
}

export function createTelemetry() {
  let sequence = 0;
  const logs: RequestLog[] = [];
  let flags: FlagSnapshot = {
    id: 0,
    values: { order_receipts: true, cart_item_details: false, strict_payment_validation: false },
  };
  const flagHistory: FlagChange[] = [];

  function record(fields: Omit<RequestLog, 'sequence' | 'at' | 'level'>) {
    const log: RequestLog = {
      ...fields,
      sequence: ++sequence,
      at: Date.now(),
      level: fields.status >= 400 ? 'error' : 'info',
    };
    logs.push(log);
    if (logs.length > LOG_LIMIT) logs.shift();
  }

  function queryLogs({ before, limit = 30, ...filters }: QueryLogs = {}) {
    const entries: RequestLog[] = [];
    for (let i = logs.length - 1; i >= 0; i--) {
      const log = logs[i];
      if ((!before || log.sequence < before) && matches(log, filters)) entries.push(log);
      if (entries.length === limit) break;
    }
    return { entries, nextBefore: entries.length === limit ? entries[entries.length - 1].sequence : null };
  }

  function tailLogs({ after, limit = 30, ...filters }: TailLogs = {}) {
    if (after === undefined) {
      return { entries: queryLogs({ limit, ...filters }).entries.reverse(), cursor: sequence, missed: false };
    }

    const entries: RequestLog[] = [];
    for (const log of logs) {
      if (log.sequence > after && matches(log, filters)) entries.push(log);
      if (entries.length === limit) break;
    }
    return {
      entries,
      cursor: entries.length === limit ? entries[entries.length - 1].sequence : sequence,
      missed: Boolean(logs.length && after < logs[0].sequence - 1),
    };
  }

  function health(): Health {
    const now = Date.now();
    const end = (Math.floor(now / BUCKET_MS) + 1) * BUCKET_MS;
    const start = end - BUCKET_COUNT * BUCKET_MS;
    const buckets = Array.from({ length: BUCKET_COUNT }, (_, i) => ({
      at: start + i * BUCKET_MS, info: 0, error: 0,
    }));
    const totals = { info: 0, error: 0 };
    for (const log of logs) {
      if (log.at < start || log.at >= end) continue;
      buckets[Math.floor((log.at - start) / BUCKET_MS)][log.level]++;
      totals[log.level]++;
    }
    return {
      start, end, bucketMs: BUCKET_MS, buckets, totals,
      markers: flagHistory.filter(event => event.at >= start && event.at < end),
    };
  }

  function setFlag(flag: FlagId, enabled: boolean, expectedSnapshotId: number, source: FlagSource) {
    if (flags.id !== expectedSnapshotId) {
      throw Object.assign(new Error('Feature flags changed. Refresh their state and try again.'), { statusCode: 409 });
    }
    if (flags.values[flag] === enabled) return flags;

    const previousEnabled = flags.values[flag];
    flags = { id: flags.id + 1, values: { ...flags.values, [flag]: enabled } };
    const change: FlagChange = { id: flags.id, flag, enabled, previousEnabled, source, at: Date.now() };
    flagHistory.push(change);
    return flags;
  }

  return {
    record, queryLogs, tailLogs, health, setFlag,
    currentFlags: () => flags,
    flagLog: (): FlagLog => ({ current: flags, definitions: flagDefinitions, history: flagHistory.slice().reverse() }),
    flagHistory: (flag: FlagId) => flagHistory.filter(change => change.flag === flag).reverse(),
  };
}

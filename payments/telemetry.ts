import {
  flagDefinitions,
  type FlagChange, type FlagId, type FlagLog, type FlagSource, type FlagValues,
  type Health, type LogFilters, type QueryLogs, type RequestLog, type TailLogs,
} from './types.js';

const BUCKET_MS = 5_000;
const BUCKET_COUNT = 24;
const LOG_LIMIT = 10_000;
const PAGE_SIZE = 30;

function matches(log: RequestLog, { level, userId, requestId, route }: LogFilters) {
  return (!level || log.level === level)
    && (!userId || log.userId === userId)
    && (!requestId || log.requestId === requestId)
    && (!route || log.route === route);
}

// Request logs and feature flags for the simulated checkout service, kept in memory.
export class Telemetry {
  private sequence = 0;
  private readonly logs: RequestLog[] = [];
  private flags: FlagValues = { order_receipts: true, cart_item_details: false, strict_payment_validation: false };
  private readonly changes: FlagChange[] = [];

  record(fields: Omit<RequestLog, 'sequence' | 'at' | 'level'>) {
    this.logs.push({
      ...fields,
      sequence: ++this.sequence,
      at: Date.now(),
      level: fields.status >= 400 ? 'error' : 'info',
    });
    if (this.logs.length > LOG_LIMIT) this.logs.shift();
  }

  queryLogs({ before, limit = PAGE_SIZE, ...filters }: QueryLogs = {}) {
    const entries: RequestLog[] = [];
    for (let i = this.logs.length - 1; i >= 0; i--) {
      const log = this.logs[i];
      if ((!before || log.sequence < before) && matches(log, filters)) entries.push(log);
      if (entries.length === limit) break;
    }
    return { entries, nextBefore: entries.length === limit ? entries[entries.length - 1].sequence : null };
  }

  tailLogs({ after, limit = PAGE_SIZE, ...filters }: TailLogs = {}) {
    if (after === undefined) {
      return { entries: this.queryLogs({ limit, ...filters }).entries.reverse(), cursor: this.sequence, missed: false };
    }

    const entries: RequestLog[] = [];
    for (const log of this.logs) {
      if (log.sequence > after && matches(log, filters)) entries.push(log);
      if (entries.length === limit) break;
    }
    return {
      entries,
      cursor: entries.length === limit ? entries[entries.length - 1].sequence : this.sequence,
      missed: Boolean(this.logs.length && after < this.logs[0].sequence - 1),
    };
  }

  health(): Health {
    const end = (Math.floor(Date.now() / BUCKET_MS) + 1) * BUCKET_MS;
    const start = end - BUCKET_COUNT * BUCKET_MS;
    const buckets = Array.from({ length: BUCKET_COUNT }, (_, i) => ({
      at: start + i * BUCKET_MS, info: 0, error: 0,
    }));
    const totals = { info: 0, error: 0 };
    for (const log of this.logs) {
      if (log.at < start || log.at >= end) continue;
      buckets[Math.floor((log.at - start) / BUCKET_MS)][log.level]++;
      totals[log.level]++;
    }
    return {
      start, end, bucketMs: BUCKET_MS, buckets, totals,
      markers: this.changes.filter(change => change.at >= start && change.at < end),
    };
  }

  currentFlags() {
    return this.flags;
  }

  setFlag(flag: FlagId, enabled: boolean, source: FlagSource) {
    if (this.flags[flag] === enabled) return this.flags;
    this.changes.push({ flag, enabled, previousEnabled: this.flags[flag], source, at: Date.now() });
    this.flags = { ...this.flags, [flag]: enabled };
    return this.flags;
  }

  flagLog(): FlagLog {
    return { current: this.flags, definitions: flagDefinitions, history: this.changes.toReversed() };
  }

  flagHistory(flag: FlagId) {
    return this.changes.filter(change => change.flag === flag).reverse();
  }
}

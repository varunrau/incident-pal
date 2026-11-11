import type { Telemetry } from '../../payments/telemetry.js';
import type { TailLogs } from '../../payments/types.js';
import type { Tool } from './index.js';
import { counter, logFilters, object } from './schemas.js';

export function tailLogs(telemetry: Telemetry): Tool<TailLogs> {
  return {
    name: 'tail_logs',
    description: 'Read new checkout logs in order. Omit after for an initial snapshot, then pass the returned cursor as after with the same filters.',
    parameters: object({ ...logFilters, after: counter }),
    execute: filters => telemetry.tailLogs(filters),
  };
}

import type { Telemetry } from '../../payments/telemetry.js';
import type { QueryLogs } from '../../payments/types.js';
import type { Tool } from './index.js';
import { logFilters, object } from './schemas.js';

export function queryLogs(telemetry: Telemetry): Tool<QueryLogs> {
  return {
    name: 'query_logs',
    description: 'Find recent checkout requests. Pass nextBefore as before for older matches.',
    parameters: object({ ...logFilters, before: { type: 'integer', minimum: 1 } }),
    execute: filters => telemetry.queryLogs(filters),
  };
}

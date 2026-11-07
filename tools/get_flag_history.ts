import type { createTelemetry } from '../telemetry.js';
import type { FlagId } from '../types.js';
import type { Tool } from './index.js';
import { flagField, object } from './schemas.js';

export function getFlagHistory(telemetry: ReturnType<typeof createTelemetry>): Tool<{ flag: FlagId }> {
  return {
    name: 'get_flag_history',
    description: 'Read one flag’s change history, newest first.',
    parameters: object({ flag: flagField }, ['flag']),
    execute: ({ flag }) => ({ history: telemetry.flagHistory(flag) }),
  };
}

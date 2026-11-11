import type { Telemetry } from '../../payments/telemetry.js';
import type { FlagId } from '../../payments/types.js';
import type { Tool } from './index.js';
import { flagField, object } from './schemas.js';

export function getFlagHistory(telemetry: Telemetry): Tool<{ flag: FlagId }> {
  return {
    name: 'get_flag_history',
    description: 'Read one flag’s change history, newest first.',
    parameters: object({ flag: flagField }, ['flag']),
    execute: ({ flag }) => ({ history: telemetry.flagHistory(flag) }),
  };
}

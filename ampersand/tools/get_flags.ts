import type { Telemetry } from '../../payments/telemetry.js';
import { flagDefinitions } from '../../payments/types.js';
import type { Tool } from './index.js';
import { object } from './schemas.js';

export function getFlags(telemetry: Telemetry): Tool {
  return {
    name: 'get_flags',
    description: 'Get flag values and last update times.',
    parameters: object(),
    execute() {
      const values = telemetry.currentFlags();
      return {
        flags: flagDefinitions.map(flag => ({
          ...flag, enabled: values[flag.id], updatedAt: telemetry.flagHistory(flag.id)[0]?.at ?? null,
        })),
      };
    },
  };
}

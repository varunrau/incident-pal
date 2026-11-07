import type { createTelemetry } from '../telemetry.js';
import { flagDefinitions } from '../types.js';
import type { Tool } from './index.js';
import { object } from './schemas.js';

export function getFlags(telemetry: ReturnType<typeof createTelemetry>): Tool {
  return {
    name: 'get_flags',
    description: 'Get flag values and last update times. Use snapshotId as expectedSnapshotId when changing a flag.',
    parameters: object(),
    execute() {
      const { id, values } = telemetry.currentFlags();
      return {
        snapshotId: id,
        flags: flagDefinitions.map(flag => ({
          ...flag, enabled: values[flag.id], updatedAt: telemetry.flagHistory(flag.id)[0]?.at ?? null,
        })),
      };
    },
  };
}

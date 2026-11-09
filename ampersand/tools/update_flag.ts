import type { createTelemetry } from '../../payments/telemetry.js';
import type { SetFlag } from '../../payments/types.js';
import type { Tool } from './index.js';
import { setFlagBody } from './schemas.js';

export function updateFlag(telemetry: ReturnType<typeof createTelemetry>): Tool<SetFlag> {
  return {
    name: 'update_flag',
    description: 'Turn any feature flag on or off. Read get_flags first for expectedSnapshotId.',
    parameters: setFlagBody,
    execute: ({ flag, enabled, expectedSnapshotId }) => telemetry.setFlag(flag, enabled, expectedSnapshotId, 'agent'),
    agentOnly: true,
  };
}

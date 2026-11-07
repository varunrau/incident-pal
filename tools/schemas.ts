import { flagDefinitions } from '../types.js';

export const object = (properties: Record<string, object> = {}, required: string[] = []) =>
  ({ type: 'object', properties, required, additionalProperties: false });

export const counter = { type: 'integer', minimum: 0 };
export const level = { type: 'string', enum: ['info', 'error'] };
export const channelField = { type: 'string', minLength: 1, maxLength: 60 };
export const flagField = { type: 'string', enum: flagDefinitions.map(flag => flag.id) };

export const setFlagBody = object({
  flag: flagField,
  expectedSnapshotId: counter,
  enabled: { type: 'boolean' },
}, ['flag', 'expectedSnapshotId', 'enabled']);

export const logFilters = {
  level,
  userId: { type: 'string', maxLength: 64 },
  requestId: { type: 'string', maxLength: 64 },
  flowId: { type: 'string', maxLength: 64 },
  flagSnapshotId: counter,
  step: { type: 'string', enum: ['Browse', 'Cart', 'Pay'] },
  limit: { type: 'integer', minimum: 1, maximum: 200 },
};

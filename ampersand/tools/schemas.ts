import { flagDefinitions, routes } from '../../payments/types.js';

export const object = (properties: Record<string, object> = {}, required: string[] = []) =>
  ({ type: 'object', properties, required, additionalProperties: false });

export const counter = { type: 'integer', minimum: 0 };
export const level = { type: 'string', enum: ['info', 'error'] };
export const channelField = { type: 'string', minLength: 1, maxLength: 60 };
export const flagField = { type: 'string', enum: flagDefinitions.map(flag => flag.id) };

export const setFlagBody = object({
  flag: flagField,
  enabled: { type: 'boolean' },
}, ['flag', 'enabled']);

export const logFilters = {
  level,
  userId: { type: 'string', maxLength: 64 },
  requestId: { type: 'string', maxLength: 64 },
  flowId: { type: 'string', maxLength: 64 },
  route: { type: 'string', enum: routes },
  limit: { type: 'integer', minimum: 1, maximum: 200 },
};

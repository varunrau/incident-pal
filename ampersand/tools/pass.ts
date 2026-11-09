import type { Tool } from './index.js';
import { object } from './schemas.js';

export const pass: Tool = {
  name: 'pass',
  description: 'Yield without a visible message when no useful action is available now. Call pass on its own.',
  parameters: object(),
  execute: () => ({ passed: true }),
};

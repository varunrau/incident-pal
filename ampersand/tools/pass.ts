import type { Tool } from './index.js';
import { object } from './schemas.js';

export const pass: Tool = {
  name: 'pass',
  description: 'Finish quietly when you have nothing useful to add.',
  parameters: object(),
  execute: () => ({ passed: true }),
  agentOnly: true,
};

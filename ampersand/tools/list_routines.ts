import type { Routines } from '../routines.js';
import type { Tool } from './index.js';
import { object } from './schemas.js';

export function listRoutines(routines: Routines): Tool {
  return {
    name: 'list_routines',
    description: 'List your active routines.',
    parameters: object(),
    execute: () => ({ routines: routines.list() }),
  };
}

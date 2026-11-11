import type { Routines } from '../routines.js';
import type { Tool } from './index.js';
import { object } from './schemas.js';

export function cancelRoutine(routines: Routines): Tool<{ routine_id: string }> {
  return {
    name: 'cancel_routine',
    description: 'Stop one of your routines, for example once the incident it was watching is resolved. Posts a '
      + 'short note in the routine\'s channel.',
    parameters: object({ routine_id: { type: 'string', minLength: 1, maxLength: 64 } }, ['routine_id']),
    execute: ({ routine_id }) => ({ cancelled: routines.cancel(routine_id) }),
  };
}

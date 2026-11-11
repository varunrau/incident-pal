import { MAX_DURATION_MINUTES, MAX_EVERY_MINUTES, type Routines } from '../routines.js';
import type { Tool } from './index.js';
import { channelField, object } from './schemas.js';

type ScheduleRoutine = { channel: string; instructions: string; every_minutes: number; duration_minutes?: number };

export function scheduleRoutine(routines: Routines): Tool<ScheduleRoutine> {
  return {
    name: 'schedule_routine',
    description: 'Wake yourself up on a fixed interval to do something, such as watching error rates during an '
      + 'incident. Each run arrives as a message with source "routine" containing your instructions. Posts a short '
      + 'note in the channel saying what you scheduled, so you do not need to announce it. Routines expire.',
    parameters: object({
      channel: { ...channelField, description: 'The channel the routine is for. Notes about it are posted here.' },
      instructions: {
        type: 'string', minLength: 1, maxLength: 1_000, pattern: '\\S',
        description: 'What to do on each run, written for your future self. People in the channel see it too.',
      },
      every_minutes: { type: 'integer', minimum: 1, maximum: MAX_EVERY_MINUTES },
      duration_minutes: {
        type: 'integer', minimum: 1, maximum: MAX_DURATION_MINUTES,
        description: 'How long the routine runs before it expires. Defaults to 240.',
      },
    }, ['channel', 'instructions', 'every_minutes']),
    execute: ({ channel, instructions, every_minutes, duration_minutes }) => ({ routine: routines.schedule(channel, instructions.trim(), every_minutes, duration_minutes) }),
  };
}

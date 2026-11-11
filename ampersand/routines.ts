import type { Chat } from '../messenger/chat.js';
import type { AgentInput, TurnObserver } from './agent.js';
import { RoutineLimitError, RoutineNotFoundError } from './errors.js';
import { ampersandAuthor } from './tools/post_message.js';

export const MAX_ROUTINES = 5;
export const MAX_EVERY_MINUTES = 24 * 60;
export const MAX_DURATION_MINUTES = 24 * 60;
export const DEFAULT_DURATION_MINUTES = 4 * 60;

const MINUTE_MS = 60_000;

interface Routine {
  id: string;
  channel: string;
  instructions: string;
  everyMinutes: number;
  createdAt: number;
  expiresAt: number;
  runs: number;
  timer: NodeJS.Timeout;
}

function summarize({ id, channel, instructions, everyMinutes, createdAt, expiresAt, runs }: Routine) {
  const interval = everyMinutes * MINUTE_MS;
  const nextRunAt = createdAt + (Math.floor((Date.now() - createdAt) / interval) + 1) * interval;
  return { id, channel, instructions, everyMinutes, runs, nextRunAt: new Date(nextRunAt).toISOString(), expiresAt: new Date(expiresAt).toISOString() };
}

const formatMinutes = (minutes: number) =>
  minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minute${minutes === 1 ? '' : 's'}`;

// Wakes Ampersand on a fixed interval with instructions it wrote for itself. Each run is sent as
// an agent input. A run is skipped while the routine's previous run is still queued or in a
// turn, so slow turns do not pile up. Routines expire, and none survive a restart.
export class Routines implements TurnObserver {
  private readonly routines = new Map<string, Routine>();
  // Routines with a run that has been sent but whose turn has not ended.
  private readonly pending = new Set<string>();
  private sequence = 0;

  constructor(private readonly chat: Chat, private readonly send: (input: AgentInput) => void) {}

  schedule(channel: string, instructions: string, everyMinutes: number, durationMinutes = DEFAULT_DURATION_MINUTES) {
    if (this.routines.size >= MAX_ROUTINES) throw new RoutineLimitError(MAX_ROUTINES);
    const id = `routine-${++this.sequence}`;
    // Posting first also checks that the channel exists before anything is scheduled.
    this.chat.postMessage(channel, ampersandAuthor,
      `⏰ I'll run this every ${formatMinutes(everyMinutes)} for the next ${formatMinutes(durationMinutes)}: ${instructions}`);
    const now = Date.now();
    const routine: Routine = {
      id, channel, instructions, everyMinutes, createdAt: now, expiresAt: now + durationMinutes * MINUTE_MS, runs: 0,
      timer: setInterval(() => this.tick(id), everyMinutes * MINUTE_MS),
    };
    routine.timer.unref();
    this.routines.set(id, routine);
    return summarize(routine);
  }

  list() {
    return [...this.routines.values()].map(summarize);
  }

  cancel(id: string) {
    const routine = this.routines.get(id);
    if (!routine) throw new RoutineNotFoundError(id);
    this.stop(routine, `⏰ Stopped the routine: ${routine.instructions}`);
    return summarize(routine);
  }

  close() {
    for (const routine of this.routines.values()) clearInterval(routine.timer);
    this.routines.clear();
  }

  toolStarted() {}
  toolFinished() {}

  turnEnded(inputs: AgentInput[]) {
    for (const { metadata } of inputs) {
      if (metadata.source === 'routine' && typeof metadata.routine_id === 'string') this.pending.delete(metadata.routine_id);
    }
  }

  private tick(id: string) {
    const routine = this.routines.get(id);
    if (!routine || this.pending.has(id)) return;
    const now = Date.now();
    const run = ++routine.runs;
    const final = now + routine.everyMinutes * MINUTE_MS > routine.expiresAt;
    this.pending.add(id);
    this.send({
      id: `routine:${id}:${run}`,
      text: routine.instructions + (final ? '\n\n(This is the last run. The routine expires after it.)' : ''),
      metadata: {
        source: 'routine', routine_id: id, channel: routine.channel, run, final_run: final ? 1 : 0,
        expires_at: Math.floor(routine.expiresAt / 1_000), timestamp: Math.floor(now / 1_000),
      },
    });
    if (final) this.stop(routine, `⏰ The routine expired: ${routine.instructions}`);
  }

  private stop(routine: Routine, note: string) {
    clearInterval(routine.timer);
    this.routines.delete(routine.id);
    this.chat.postMessage(routine.channel, ampersandAuthor, note);
  }
}

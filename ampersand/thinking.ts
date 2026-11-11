import type { Chat } from '../messenger/chat.js';
import type { AgentInput, TurnObserver } from './agent.js';

const channelsOf = (inputs: AgentInput[]) =>
  new Set(inputs.flatMap(({ metadata: { channel } }) => typeof channel === 'string' ? [channel] : []));

// Shows "Ampersand is thinking…" in the channels a turn is responding to. It appears at the turn's
// first tool call, and goes away when Ampersand posts in that channel or ends the turn.
export class ThinkingIndicator implements TurnObserver {
  // Channels Ampersand has already posted in this turn. Later tool calls do not show it there again.
  private answered = new Set<string>();

  constructor(private readonly chat: Chat) {}

  toolStarted(inputs: AgentInput[], name: string) {
    if (name === 'post_message') return;
    for (const channel of channelsOf(inputs)) {
      if (!this.answered.has(channel)) this.chat.setThinking(channel, true);
    }
  }

  toolFinished(inputs: AgentInput[], name: string, args: unknown) {
    const channel: unknown = name === 'post_message' && typeof args === 'object' && args !== null ? Reflect.get(args, 'channel') : undefined;
    if (typeof channel !== 'string') return;
    this.answered.add(channel);
    this.chat.setThinking(channel, false);
  }

  turnEnded(inputs: AgentInput[]) {
    this.answered.clear();
    for (const channel of channelsOf(inputs)) this.chat.setThinking(channel, false);
  }
}

import { useEffect, useMemo, useState } from 'react';
import type { ChatMessage } from '../types.js';

const READ_KEY = 'incident-pal-chat-read';

// The time of the newest message the viewer has seen in each channel. Timestamps survive a server
// restart, unlike message IDs.
type ReadAt = Record<string, number>;

function loadReadAt(): ReadAt | undefined {
  try {
    return JSON.parse(localStorage.getItem(READ_KEY) ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

function saveReadAt(readAt: ReadAt) {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(readAt));
  } catch {
    // Unread counts still work for this page load without storage.
  }
}

const newestAt = (rows: ChatMessage[] | undefined) => rows?.at(-1)?.at ?? 0;

// Counts unread messages per channel. Viewing a channel marks it read, and the viewer's own
// messages never count. On a first visit, everything already in the chat counts as read.
export function useUnread(messages: Record<string, ChatMessage[]>, loaded: boolean, active?: string, ownId?: string) {
  const [readAt, setReadAt] = useState(loadReadAt);

  useEffect(() => {
    if (loaded && !readAt) {
      setReadAt(Object.fromEntries(Object.entries(messages).map(([channel, rows]) => [channel, newestAt(rows)])));
    }
  }, [loaded, readAt, messages]);

  const activeNewest = active ? newestAt(messages[active]) : 0;
  useEffect(() => {
    if (!active || !readAt || (readAt[active] ?? 0) >= activeNewest) return;
    setReadAt({ ...readAt, [active]: activeNewest });
  }, [active, activeNewest, readAt]);

  useEffect(() => {
    if (readAt) saveReadAt(readAt);
  }, [readAt]);

  return useMemo(() => {
    const counts: Record<string, number> = {};
    if (!readAt) return counts;
    for (const [channel, rows] of Object.entries(messages)) {
      const since = readAt[channel] ?? 0;
      counts[channel] = rows.filter(message => message.at > since && message.author.id !== ownId).length;
    }
    return counts;
  }, [messages, readAt, ownId]);
}

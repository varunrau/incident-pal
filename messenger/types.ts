export interface ChatChannel {
  id: string;
  topic: string;
}

export interface ChatAuthor {
  id: string;
  name: string;
  avatar?: string;
}

export interface ChatMessage {
  id: number;
  channel: string;
  author: ChatAuthor;
  text: string;
  at: number;
}

export interface ChatSnapshot {
  channels: ChatChannel[];
  messages: ChatMessage[];
}

export const responseChannel = 'incident-response';
export const statusChannel = 'global-incident-status';

export interface ChatSession {
  author: ChatAuthor;
  token: string;
}

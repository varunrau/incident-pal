export interface ChatChannel {
  id: string;
  topic: string;
}

export interface ChatAuthor {
  id: string;
  name: string;
  // URL of the author's avatar image.
  avatar: string;
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

export interface ChatSession {
  author: ChatAuthor;
  token: string;
}

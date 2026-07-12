export interface GrayscaleFrame {
  data: string;
  height: number;
  width: number;
}

export interface VideoPresence extends Record<string, unknown> {
  frame: GrayscaleFrame;
  name: string;
}

export interface ChatMessage {
  author: string;
  id: string;
  sentAt: number;
  text: string;
}

export interface ChatLedger {
  messages: ChatMessage[];
  version: 1;
}

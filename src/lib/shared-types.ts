export interface GrayscaleFrame {
  bits?: number;
  data: string;
  height: number;
  width: number;
}

export interface VideoPresence extends Record<string, unknown> {
  frame: GrayscaleFrame;
  name: string;
  payloadRate?: VideoPayloadRate;
}

export interface VideoPayloadRate {
  bytesPerSecond: number;
  measuredAt: number;
  windowMs: number;
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

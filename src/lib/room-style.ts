export const MAX_ROOM_CSS_LENGTH = 20_000;

export const ROOM_STYLE_TARGETS = [
  '[data-room-part="room"]',
  '[data-room-part="title"]',
  '[data-room-part="video-area"]',
  '[data-room-part="video-field"]',
  '[data-room-part="video-grid"]',
  '[data-room-part="video-card"]',
  '[data-room-part="video-frame"]',
  '[data-room-part="video-caption"]',
  '[data-room-part="video-rate"]',
  '[data-room-part="leave"]',
  '[data-room-part="sidebar"]',
  '[data-room-part="sidebar-tabs"]',
  '[data-room-part="chat"]',
  '[data-room-part="message"]',
  '[data-room-part="message"][data-message-side="own"]',
  '[data-room-part="message"][data-message-side="other"]',
  '[data-room-part="chat-controls"]',
  '[data-room-part="settings"]',
  '[data-room-part="style"]',
] as const;

export const ROOM_STYLE_SCAFFOLD = ROOM_STYLE_TARGETS.map(
  (selector) => `${selector} {\n  \n}`,
).join("\n\n");

export interface RoomStyleData {
  css: string;
  updatedAt: number;
  updatedBy: string;
  version: 1;
}

export interface CollaborativeRoomStyleData {
  /**
   * UTF-16 code units, matching textarea selection offsets. Null means this
   * room has not migrated from the legacy scalar CSS document yet.
   */
  chars: string[] | null;
  updatedAt: number;
  updatedBy: string;
  version: 2;
}

export const DEFAULT_ROOM_STYLE: RoomStyleData = {
  css: ROOM_STYLE_SCAFFOLD,
  updatedAt: 0,
  updatedBy: "",
  version: 1,
};

export const DEFAULT_COLLABORATIVE_ROOM_STYLE: CollaborativeRoomStyleData = {
  chars: null,
  updatedAt: 0,
  updatedBy: "",
  version: 2,
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasSelectorBlock(css: string, selector: string) {
  return new RegExp(`${escapeRegExp(selector)}\\s*\\{`).test(css);
}

export function ensureRoomStyleScaffold(css: string) {
  const limitedCss = css.slice(0, MAX_ROOM_CSS_LENGTH);
  const missingBlocks = ROOM_STYLE_TARGETS.filter(
    (selector) => !hasSelectorBlock(limitedCss, selector),
  ).map((selector) => `${selector} {\n  \n}`);

  if (missingBlocks.length === 0) return limitedCss;

  const suffix = `\n\n${missingBlocks.join("\n\n")}`;
  const availableLength = Math.max(0, MAX_ROOM_CSS_LENGTH - suffix.length);
  return `${limitedCss.slice(0, availableLength).trimEnd()}${suffix}`;
}

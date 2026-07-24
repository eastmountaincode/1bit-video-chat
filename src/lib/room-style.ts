import {
  createTextEntries,
  readTextEntriesSafely,
} from "./shared-text-entries.ts";

export const MAX_ROOM_CSS_LENGTH = 20_000;

export const ROOM_STYLE_TARGETS = [
  '[data-room-part="room"]',
  '[data-room-part="title"]',
  '[data-room-part="video-area"]',
  '[data-room-part="video-field"]',
  '[data-room-part="video-grid"]',
  '[data-room-part="video-card"]',
  '[data-room-part="video-card"][data-video-side="own"]',
  '[data-room-part="video-frame"]',
  '[data-room-part="video-pixel"]',
  '[data-room-part="video-caption"]',
  '[data-room-part="video-rate"]',
  '[data-room-part="leave"]',
  '[data-room-part="sidebar"]',
  '[data-room-part="sidebar-tabs"]',
  '[data-room-part="chat"]',
  '[data-room-part="message"]',
  '[data-room-part="message"][data-message-side="own"]',
  '[data-room-part="message"][data-message-side="other"]',
  '[data-room-part="settings"]',
  '[data-room-part="style"]',
] as const;

const OBSOLETE_ROOM_STYLE_TARGETS = [
  '[data-room-part="chat-controls"]',
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
   * room has not migrated from the legacy scalar CSS document yet. Retained as
   * a rolling v3 compatibility mirror while already-open clients age out.
   */
  chars: string[] | null;
  /**
   * Replacing this object selects a new document epoch atomically. Its text is
   * stored as stable-ID UTF-16 entries for identity-safe concurrent editing.
   */
  current: RoomStyleDocument | null;
  updatedAt: number;
  updatedBy: string;
  version: 2 | 3 | 4;
}

export interface RoomStyleDocument {
  createdAt: number;
  entries: string[];
  id: string;
}

export const DEFAULT_ROOM_STYLE: RoomStyleData = {
  css: ROOM_STYLE_SCAFFOLD,
  updatedAt: 0,
  updatedBy: "",
  version: 1,
};

export const DEFAULT_COLLABORATIVE_ROOM_STYLE: CollaborativeRoomStyleData = {
  chars: null,
  current: null,
  updatedAt: 0,
  updatedBy: "",
  version: 3,
};

export function getCollaborativeRoomStyleCss(
  style: CollaborativeRoomStyleData,
  fallback: string,
) {
  if (Array.isArray(style.current?.entries)) {
    return (
      readTextEntriesSafely(
        style.current.entries,
        MAX_ROOM_CSS_LENGTH,
      ) ?? fallback
    );
  }
  if (Array.isArray(style.chars)) {
    return (
      readLegacyRoomStyleCss(style.chars, MAX_ROOM_CSS_LENGTH) ??
      fallback
    );
  }
  return fallback;
}

export function createRoomStyleDocument(
  css: string,
  id: string,
  createdAt: number,
): RoomStyleDocument {
  return {
    createdAt,
    entries: createTextEntries(css, "b"),
    id,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasSelectorBlock(css: string, selector: string) {
  return new RegExp(`${escapeRegExp(selector)}\\s*\\{`).test(css);
}

export function ensureRoomStyleScaffold(css: string) {
  const normalizedCss = OBSOLETE_ROOM_STYLE_TARGETS.reduce(
    (currentCss, selector) =>
      currentCss.replace(
        new RegExp(`${escapeRegExp(selector)}\\s*\\{[^{}]*\\}\\s*`, "g"),
        "",
      ),
    css,
  );
  const limitedCss = normalizedCss.slice(0, MAX_ROOM_CSS_LENGTH);
  const missingBlocks = ROOM_STYLE_TARGETS.filter(
    (selector) => !hasSelectorBlock(limitedCss, selector),
  ).map((selector) => `${selector} {\n  \n}`);

  if (missingBlocks.length === 0) return limitedCss;

  const suffix = `\n\n${missingBlocks.join("\n\n")}`;
  const availableLength = Math.max(0, MAX_ROOM_CSS_LENGTH - suffix.length);
  return `${limitedCss.slice(0, availableLength).trimEnd()}${suffix}`;
}

export function normalizeCollaborativeRoomStyleCss(
  css: string,
  version: CollaborativeRoomStyleData["version"],
) {
  return version === 4
    ? css.slice(0, MAX_ROOM_CSS_LENGTH)
    : ensureRoomStyleScaffold(css);
}

export function readLegacyRoomStyleCss(
  characters: unknown[],
  maxLength = MAX_ROOM_CSS_LENGTH,
) {
  const length = Math.min(characters.length, maxLength);
  let css = "";

  for (let index = 0; index < length; index += 1) {
    const character = characters[index];
    if (typeof character !== "string" || character.length !== 1) {
      return null;
    }
    css += character;
  }

  return css;
}

export function syncLegacyRoomStyleCharacters(
  style: CollaborativeRoomStyleData,
  css: string,
) {
  const limitedCss = css.slice(0, MAX_ROOM_CSS_LENGTH);
  if (!Array.isArray(style.chars)) {
    style.chars = limitedCss.split("");
    return true;
  }

  const currentCss = readLegacyRoomStyleCss(
    style.chars,
    MAX_ROOM_CSS_LENGTH,
  );
  if (
    currentCss === limitedCss &&
    style.chars.length === limitedCss.length
  ) {
    return false;
  }

  // Repairs and resets can run on every connected client at once. Replacing
  // the property lets Yjs select one complete mirror instead of interleaving
  // many identical array splices.
  style.chars = limitedCss.split("");
  return true;
}

/**
 * Per-frame pixel metadata is expensive to maintain across a large room. Most
 * room styles only need the stable pixel selectors/coordinates, so the video
 * renderer enables live level values only when the shared CSS asks for them.
 */
export function roomStyleUsesLivePixelMetadata(css: string) {
  const uncommentedCss = stripCssComments(css);

  if (/--pixel-(?:gray|level)\b|data-pixel-level/i.test(uncommentedCss)) {
    return true;
  }

  for (const rule of uncommentedCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector = "", declarations = ""] = rule;
    if (!isVideoPixelSelector(selector)) continue;

    if (pixelRuleNeedsSourceCells(declarations)) return true;
  }

  return false;
}

function pixelRuleNeedsSourceCells(declarations: string) {
  for (const declaration of declarations.matchAll(
    /(?:^|;)\s*([\w-]+)\s*:/g,
  )) {
    const property = (declaration[1] ?? "").toLowerCase();
    if (!property || property.startsWith("--")) continue;

    const paintsOverlayWithoutSourceCells =
      property === "color" ||
      property === "box-shadow" ||
      property === "text-shadow" ||
      property === "cursor" ||
      property === "pointer-events" ||
      property === "user-select" ||
      property === "touch-action" ||
      property === "caret-color" ||
      property === "accent-color" ||
      property === "border" ||
      (property.startsWith("background-") || property === "background") ||
      (property.startsWith("outline-") || property === "outline") ||
      (property.startsWith("border-") &&
        !property.startsWith("border-radius"));

    if (!paintsOverlayWithoutSourceCells) return true;
  }

  return false;
}

/** Avoid mounting thousands of style-only spans until room CSS uses them. */
export function roomStyleUsesVideoPixelOverlay(css: string) {
  const uncommentedCss = stripCssComments(css);
  const withoutEmptyScaffoldBlock = uncommentedCss.replace(
    /\[data-room-part\s*=\s*(?:["']video-pixel["']|video-pixel)\]\s*\{\s*\}/gi,
    "",
  );

  return /\[data-room-part\s*=\s*(?:["']video-pixel["']|video-pixel)\]|data-pixel-(?:index|x|y|level)|--pixel-(?:index|x|y|level|gray)\b|\.grayscale-pixel\b/i.test(
    withoutEmptyScaffoldBlock,
  );
}

function isVideoPixelSelector(selector: string) {
  return /\[data-room-part\s*=\s*(?:["']video-pixel["']|video-pixel)\]|data-pixel-(?:index|x|y|level)|\.grayscale-pixel\b/i.test(
    selector,
  );
}

function stripCssComments(css: string) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

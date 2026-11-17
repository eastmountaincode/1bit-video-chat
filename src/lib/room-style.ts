import {
  createTextEntries,
  readTextEntriesSafely,
} from "./shared-text-entries.ts";
import { normalizeRoomStyleSelectors } from "./owned-room-style.ts";

export const MAX_ROOM_CSS_LENGTH = 20_000;
export const ROOM_STYLE_COMMENTS_VERSION = 1;
export const ROOM_STYLE_TEMPLATE_VERSION = 1;
// Keep templateVersion at 1 for open clients that check it for exact equality.
export const ROOM_STYLE_TEMPLATE_REVISION = 4;

const OWN_VIDEO_STYLE_TARGETS = [
    '[data-room-part="video-caption"][data-side="own"]',
    '[data-room-part="video-rate"][data-side="own"]',
] as const;

export const ROOM_STYLE_TARGETS = [
  '[data-room-part="room"]',
  '[data-room-part="title"]',
  '[data-room-part="video-area"]',
  '[data-room-part="video-field"]',
  '[data-room-part="video-grid"]',
  '[data-room-part="video-card"]',
  '[data-room-part="video-card"][data-side="own"]',
  '[data-room-part="video-frame"]',
  '[data-room-part="video-caption"]',
  '[data-room-part="video-rate"]',
    ...OWN_VIDEO_STYLE_TARGETS,
  '[data-room-part="leave"]',
  '[data-room-part="divider"]',
  '[data-room-part="sidebar"]',
  '[data-room-part="sidebar-tabs"]',
  '[data-room-part="chat"]',
  '[data-room-part="message"]',
  '[data-room-part="message"][data-side="own"]',
  '[data-room-part="message"][data-side="other"]',
  '[data-room-part="message-author"]',
  '[data-room-part="message-time"]',
  '[data-room-part="message-text"]',
  '[data-room-part="settings"]',
  '[data-room-part="style"]',
  '[data-room-part="hydra"]',
  '[data-room-part="hydra-background"]',
] as const;

export const DEFAULT_ROOM_STYLE_TARGETS = [
    '[data-room-part="room"]',
    '[data-room-part="title"]',
    '[data-room-part="video-field"]',
    '[data-room-part="video-card"]',
    '[data-room-part="video-frame"]',
    ...OWN_VIDEO_STYLE_TARGETS,
    '[data-room-part="chat"]',
    '[data-room-part="message"][data-side="own"]',
    '[data-room-part="message"][data-side="other"]',
    '[data-room-part="message-author"]',
    '[data-room-part="message-time"]',
] as const satisfies readonly (typeof ROOM_STYLE_TARGETS)[number][];

const NEW_CHAT_TARGETS: readonly (typeof ROOM_STYLE_TARGETS)[number][] = [
    '[data-room-part="message-author"]',
    '[data-room-part="message-time"]',
    '[data-room-part="message-text"]',
];

const OBSOLETE_ROOM_STYLE_TARGETS = [
  '[data-room-part="chat-controls"]',
  '[data-room-part="strudel"]',
  '[data-room-part="video-pixel"]',
] as const;

const ROOM_STYLE_COMMENTS: Record<(typeof ROOM_STYLE_TARGETS)[number], string> = {
    '[data-room-part="room"]': "The whole room.",
    '[data-room-part="title"]': "The room title.",
    '[data-room-part="video-area"]': "The video side of the room.",
    '[data-room-part="video-field"]': "The box around all the videos.",
    '[data-room-part="video-grid"]': "How the videos are arranged.",
    '[data-room-part="video-card"]': "Each person's video card.",
    '[data-room-part="video-card"][data-side="own"]': "Your own video card.",
    '[data-room-part="video-frame"]': "The video image.",
    '[data-room-part="video-caption"]': "The name below each video.",
    '[data-room-part="video-rate"]': "The data rate below each video.",
    '[data-room-part="video-caption"][data-side="own"]': "The name below your own video.",
    '[data-room-part="video-rate"][data-side="own"]': "The data rate below your own video.",
    '[data-room-part="leave"]': "The leave room button.",
    '[data-room-part="divider"]': "The draggable line between the two sides.",
    '[data-room-part="sidebar"]': "The chat and controls side.",
    '[data-room-part="sidebar-tabs"]': "The buttons for switching panels.",
    '[data-room-part="chat"]': "The chat panel.",
    '[data-room-part="message"]': "Every chat message.",
    '[data-room-part="message"][data-side="own"]': "Your own chat messages.",
    '[data-room-part="message"][data-side="other"]': "Everyone else's chat messages.",
    '[data-room-part="message-author"]': "Names in chat.",
    '[data-room-part="message-time"]': "Chat dates and times.",
    '[data-room-part="message-text"]': "The text of each message.",
    '[data-room-part="settings"]': "The camera settings panel.",
    '[data-room-part="style"]': "This CSS editor panel.",
    '[data-room-part="hydra"]': "The Hydra code panel.",
    '[data-room-part="hydra-background"]': "The Hydra visuals behind the room.",
};

function roomStyleBlock(selector: (typeof ROOM_STYLE_TARGETS)[number]) {
    return `/* ${ROOM_STYLE_COMMENTS[selector]} */\n${selector} {\n    \n}`;
}

export const ROOM_STYLE_SCAFFOLD = DEFAULT_ROOM_STYLE_TARGETS.map(roomStyleBlock).join("\n\n");
const ORIGINAL_SCAFFOLD = ROOM_STYLE_TARGETS.filter((selector) =>
    !NEW_CHAT_TARGETS.includes(selector) && !(OWN_VIDEO_STYLE_TARGETS as readonly string[]).includes(selector))
    .map((selector) => `${selector}{}`).join("");

export function migrateRoomStyleCss(css: string, commentsVersion?: number, templateRevision?: number): string {
    let current = removeObsoleteRoomStyleTargets(css);
    if ((templateRevision ?? 0) < ROOM_STYLE_TEMPLATE_REVISION) {
        current = normalizeRoomStyleSelectors(current);
        let uncommented = current;
        for (const comment of Object.values(ROOM_STYLE_COMMENTS)) uncommented = uncommented.replaceAll(`/* ${comment} */`, "");
        if (uncommented.replace(/\s/g, "") === ORIGINAL_SCAFFOLD) return ROOM_STYLE_SCAFFOLD;
        current = simplifyRoomStyleTemplate(current, (templateRevision ?? 0) < 1);
    }
    if (commentsVersion === ROOM_STYLE_COMMENTS_VERSION) return current;
    return addRoomStyleComments(current);
}

function simplifyRoomStyleTemplate(css: string, addChatTargets: boolean): string {
    const defaults: readonly string[] = DEFAULT_ROOM_STYLE_TARGETS;
    const retired = new Set<string>(ROOM_STYLE_TARGETS.filter((selector) => !defaults.includes(selector)));
    const replacements: { start: number; end: number; text: string }[] = [];
    let boundary = 0;
    let quote = "";
    const stack: { start: number; open: number; selector: string; leading: string }[] = [];
    let hasChat = false;
    let hasVideoCaption = false;
    for (let index = 0; index < css.length; index += 1) {
        const character = css[index];
        if (quote) {
            if (character === "\\") index += 1;
            else if (character === quote) quote = "";
            continue;
        }
        if (character === "/" && css[index + 1] === "*") {
            const end = css.indexOf("*/", index + 2);
            if (end < 0) break;
            if (css.slice(index, end + 2) === "/* Your chat messages. */") {
                replacements.push({ start: index, end: end + 2, text: "/* Your own chat messages. */" });
            }
            index = end + 1;
            continue;
        }
        if (character === '"' || character === "'") {
            quote = character;
            continue;
        }
        if (character === "{") {
            const segment = css.slice(boundary, index);
            const leading = /^(?:\s|\/\*[\s\S]*?\*\/)*/.exec(segment)?.[0] ?? "";
            const selector = segment.slice(leading.length).trim();
            if (selector === '[data-room-part="chat"]' || selector.startsWith('[data-room-part="message"]')) hasChat = true;
            if (selector.startsWith('[data-room-part="video-caption"]')) hasVideoCaption = true;
            stack.push({ start: boundary, open: index, selector, leading });
            boundary = index + 1;
        } else if (character === "}") {
            const rule = stack.pop();
            if (rule && stack.length === 0 && retired.has(rule.selector) && !css.slice(rule.open + 1, index).trim()) {
                const comment = `/* ${ROOM_STYLE_COMMENTS[rule.selector as keyof typeof ROOM_STYLE_COMMENTS]} */`;
                const generated = !rule.leading.replace(comment, "").trim();
                replacements.push({ start: rule.start + (generated ? 0 : rule.leading.length), end: index + 1, text: "" });
            }
            boundary = index + 1;
        } else if (character === ";") boundary = index + 1;
    }
    let result = css;
    for (const { start, end, text } of replacements.sort((a, b) => b.start - a.start)) {
        if (result.length + text.length - (end - start) > MAX_ROOM_CSS_LENGTH) continue;
        result = result.slice(0, start) + text + result.slice(end);
    }
    const additions = [
        ...(hasChat && addChatTargets ? NEW_CHAT_TARGETS.filter((target) => defaults.includes(target)) : []),
        ...(hasVideoCaption ? OWN_VIDEO_STYLE_TARGETS : []),
    ];
    for (const selector of additions) {
        if (hasSelectorBlock(result, selector)) continue;
        const block = `\n\n${roomStyleBlock(selector)}`;
        if (result.length + block.length <= MAX_ROOM_CSS_LENGTH) result += block;
    }
    return result;
}

function addRoomStyleComments(css: string): string {
    const additions: { at: number; text: string }[] = [];
    let boundary = 0;
    let quote = "";
    let length = css.length;
    for (let index = 0; index < css.length; index += 1) {
        const character = css[index];
        if (quote) {
            if (character === "\\") index += 1;
            else if (character === quote) quote = "";
            continue;
        }
        if (character === "/" && css[index + 1] === "*") {
            const end = css.indexOf("*/", index + 2);
            if (end < 0) break;
            index = end + 1;
            continue;
        }
        if (character === '"' || character === "'") {
            quote = character;
            continue;
        }
        if (character === "{") {
            const segment = css.slice(boundary, index);
            const leading = /^(?:\s|\/\*[\s\S]*?\*\/)*/.exec(segment)?.[0] ?? "";
            const selector = segment.slice(leading.length).trim()
                .replace(/\[\s*data-([\w-]+)\s*=\s*(['"])(.*?)\2\s*\]/g, '[data-$1="$3"]');
            if (Object.hasOwn(ROOM_STYLE_COMMENTS, selector) && !leading.includes("/*")) {
                const comment = ROOM_STYLE_COMMENTS[selector as keyof typeof ROOM_STYLE_COMMENTS];
                const indent = /(?:^|\n)([\t ]*)$/.exec(leading)?.[1] ?? "";
                const text = `/* ${comment} */\n${indent}`;
                if (length + text.length <= MAX_ROOM_CSS_LENGTH) {
                    additions.push({ at: boundary + leading.length, text });
                    length += text.length;
                }
            }
        }
        if (character === "{" || character === "}" || character === ";") boundary = index + 1;
    }
    let result = css;
    for (const { at, text } of additions.reverse()) result = result.slice(0, at) + text + result.slice(at);
    return result;
}

export interface RoomStyleData {
  css: string;
  updatedAt: number;
  updatedBy: string;
  version: 1;
}

export interface CollaborativeRoomStyleData {
  scaffoldVersion?: 1;
  commentsVersion?: 1;
  templateVersion?: 1;
  templateRevision?: number;
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
  const normalizedCss = migrateRoomStyleCss(css);
  const limitedCss = normalizedCss.slice(0, MAX_ROOM_CSS_LENGTH);
  const missingBlocks = DEFAULT_ROOM_STYLE_TARGETS.filter(
    (selector) => !hasSelectorBlock(limitedCss, selector),
  ).map(roomStyleBlock);

  if (missingBlocks.length === 0) return limitedCss;

  let result = limitedCss;
  for (const block of missingBlocks) {
    const next = `${result.trimEnd()}\n\n${block}`;
    if (next.length <= MAX_ROOM_CSS_LENGTH) result = next;
  }
  return result;
}

export function removeObsoleteRoomStyleTargets(css: string) {
  return OBSOLETE_ROOM_STYLE_TARGETS.reduce(
    (currentCss, selector) =>
      removeStandaloneSelectorBlocks(currentCss, selector),
    css,
  );
}

function removeStandaloneSelectorBlocks(css: string, selector: string) {
  const pattern = new RegExp(
    `(^|[{}])(\\s*)${escapeRegExp(selector)}\\s*\\{[^{}]*\\}`,
    "g",
  );
  let currentCss = css;

  while (true) {
    const nextCss = currentCss.replace(
      pattern,
      (_, boundary: string, spacing: string) => `${boundary}${spacing}`,
    );
    if (nextCss === currentCss) return currentCss;
    currentCss = nextCss;
  }
}

export function normalizeCollaborativeRoomStyleCss(
  css: string,
  version: CollaborativeRoomStyleData["version"],
) {
  const sanitizedCss = removeObsoleteRoomStyleTargets(css);
  return version === 4
    ? sanitizedCss.slice(0, MAX_ROOM_CSS_LENGTH)
    : ensureRoomStyleScaffold(sanitizedCss);
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

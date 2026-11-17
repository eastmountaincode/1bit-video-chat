import type { CollaborativeCodeDocument } from "./collaborative-code.ts";
import { createTextEntries, readTextEntries, mergeTextEntrySplices, mapSelectionByIdentity, type SharedTextMerge } from "./shared-text-entries.ts";

import { type TextSelection, type TextSplice } from "./collaborative-text.ts";
import { mergeEntryChanges } from "./code-editor-history.ts";

export const OWNED_ROOM_STYLE_CHANNEL = "room-style:v3";
export const MAX_STORED_ROOM_CSS_LENGTH = 400_000;

interface Ownership {
    template: string;
    templateLayout?: { index: number; left: string | null; right: string | null }[];
    people: Record<string, { entries: string[]; anchors?: Record<string, StyleAnchor> }>;
}

interface StyleAnchor {
    left: string | null;
    right: string | null;
}

export interface OwnedStyleDocument extends CollaborativeCodeDocument {
    ownership?: Ownership;
    selectorVersion?: 1;
}

interface OwnershipToken {
    start: number;
    end: number;
    side: "own" | "other";
}

interface StyleBlock {
    start: number;
    end: number;
    tokens: OwnershipToken[];
}

export function styleOwnerId(identity: string): string {
    return `p-${Array.from(new TextEncoder().encode(identity), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function hasOwnedStyle(document: OwnedStyleDocument, owner: string): boolean {
    return document.selectorVersion === 1 && Array.isArray(document.ownership?.people[owner]?.entries);
}

function partition(entries: string[]) {
    const css = readTextEntries(entries);
    const shared: string[] = [];
    const personal: string[] = [];
    let start = 0;
    for (const block of styleBlocks(css)) {
        // Keep line breaks with the rule they follow, including trailing paste
        // whitespace, so its caret does not move into a different ownership group.
        let end = block.end;
        while (end < css.length && /\s/.test(css[end])) end += 1;
        const target = block.tokens.length > 0 ? personal : shared;
        for (let index = start; index < end; index += 1) target.push(entries[index]);
        start = end;
    }
    return { shared, personal };
}

export function prepareOwnedStyle(document: OwnedStyleDocument, owner: string, prefix: () => string): void {
    if (document.selectorVersion !== 1) {
        migrateSideEntries(document.entries);
        if (document.ownership) {
            document.ownership.template = normalizeRoomStyleSelectors(document.ownership.template);
            for (const person of Object.values(document.ownership.people)) migrateSideEntries(person.entries);
        }
        document.selectorVersion = 1;
    }
    if (!document.ownership) {
        const parts = partition(document.entries);
        const anchors = personalAnchors(document.entries, new Set(parts.personal));
        document.ownership = {
            template: readTextEntries(parts.personal),
            templateLayout: Object.entries(anchors).map(([entry, anchor]) => ({ index: parts.personal.indexOf(entry), ...anchor })),
            people: {},
        };
        document.entries = parts.shared;
    }
    if (hasOwnedStyle(document, owner)) return;
    const used = document.entries.length + Object.values(document.ownership.people).reduce((total, person) => total + person.entries.length, 0);
    const template = used + document.ownership.template.length <= MAX_STORED_ROOM_CSS_LENGTH ? document.ownership.template : "";
    const entries = createTextEntries(template, prefix());
    document.ownership.people[owner] = {
        entries,
        anchors: Object.fromEntries((document.ownership.templateLayout ?? [])
            .filter((anchor) => anchor.index < entries.length)
            .map(({ index, left, right }) => [entries[index], { left, right }])),
    };
}

export function projectOwnedStyle(document: OwnedStyleDocument, owner: string): string[] {
    const person = document.ownership?.people[owner];
    if (!person?.anchors) return [...document.entries, ...(person?.entries ?? [])];
    const sharedPositions = new Map(document.entries.map((entry, index) => [entry, index]));
    const groups = new Map<number, string[]>();
    let position = document.entries.length;
    for (const entry of person.entries) {
        const anchor = person.anchors[entry];
        if (anchor) {
            const right = anchor.right === null ? undefined : sharedPositions.get(anchor.right);
            const left = anchor.left === null ? undefined : sharedPositions.get(anchor.left);
            position = right ?? (left === undefined ? document.entries.length : left + 1);
        }
        const group = groups.get(position) ?? [];
        group.push(entry);
        groups.set(position, group);
    }
    const entries: string[] = [];
    for (let index = 0; index <= document.entries.length; index += 1) {
        entries.push(...(groups.get(index) ?? []));
        if (index < document.entries.length) entries.push(document.entries[index]);
    }
    return entries;
}

function personalAnchors(entries: string[], personal: Set<string>): Record<string, StyleAnchor> {
    const anchors: Record<string, StyleAnchor> = {};
    let left: string | null = null;
    for (let index = 0; index < entries.length;) {
        if (!personal.has(entries[index])) { left = entries[index++]; continue; }
        const first = entries[index];
        while (index < entries.length && personal.has(entries[index])) index += 1;
        anchors[first] = { left, right: entries[index] ?? null };
    }
    return anchors;
}

export function mergeOwnedStyle(
    document: OwnedStyleDocument,
    owner: string,
    base: string[],
    splices: TextSplice[],
    selection: TextSelection,
    prefix: () => string,
    maxLength: number,
): SharedTextMerge {
    const visible = projectOwnedStyle(document, owner);
    const result = mergeTextEntrySplices(base, visible, splices, selection, prefix, maxLength);
    return applyOwnedStyleEntries(document, owner, result.entries, result.selection, maxLength);
}

// Keep the editor order separate from storage grouping. Original character IDs
// survive scope changes and undo, so concurrent edits still target the same text.
export function applyOwnedStyleEntries(
    document: OwnedStyleDocument,
    owner: string,
    desired: string[],
    selection: TextSelection,
    maxLength: number,
): SharedTextMerge {
    const person = document.ownership?.people[owner];
    const visible = projectOwnedStyle(document, owner);
    if (!person) return { accepted: false, entries: visible, operations: [], selection, text: readTextEntries(visible) };
    const after = partition(desired);
    const otherLength = Object.entries(document.ownership!.people).reduce((total, [id, value]) => total + (id === owner ? 0 : value.entries.length), 0);
    if (desired.length > maxLength || desired.length + otherLength > MAX_STORED_ROOM_CSS_LENGTH) {
        return { accepted: false, entries: visible, operations: [], selection: mapSelectionByIdentity(desired, visible, selection), text: readTextEntries(visible) };
    }
    const shared = mergeEntryChanges(document.entries, after.shared, document.entries);
    const personal = mergeEntryChanges(person.entries, after.personal, person.entries);
    for (const operation of shared.operations) document.entries.splice(operation.index, operation.deleteCount, ...operation.insert);
    for (const operation of personal.operations) person.entries.splice(operation.index, operation.deleteCount, ...operation.insert);
    const anchors = personalAnchors(desired, new Set(after.personal));
    person.anchors ??= {};
    // Update individual anchors so simultaneous tabs do not replace each
    // other's newly inserted positions with an older copy of the whole map.
    for (const entry of Object.keys(person.anchors)) {
        if (!anchors[entry]) delete person.anchors[entry];
    }
    for (const [entry, anchor] of Object.entries(anchors)) {
        const previous = person.anchors[entry];
        if (!previous || previous.left !== anchor.left || previous.right !== anchor.right) person.anchors[entry] = anchor;
    }
    const entries = projectOwnedStyle(document, owner);
    return {
        accepted: true,
        entries,
        operations: [...shared.operations, ...personal.operations],
        selection: mapSelectionByIdentity(desired, entries, selection),
        text: readTextEntries(entries),
    };
}

export function renderOwnedStyles(document: OwnedStyleDocument): { id: string; css: string }[] {
    const styles = [{ id: "room", css: readTextEntries(document.entries) }];
    for (const [owner, person] of Object.entries(document.ownership?.people ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
        if (!/^p-[0-9a-f]+$/.test(owner)) continue;
        let css = readTextEntries(person.entries);
        if (!css) continue;
        const tokens = styleBlocks(css).flatMap((block) => block.tokens);
        for (const token of tokens.sort((a, b) => b.start - a.start)) {
            // Give own rules higher specificity than the equivalent other rule.
            const replacement = token.side === "own"
                ? '[data-style-owner="' + owner + '"][data-style-owner="' + owner + '"]'
                : ':where([data-style-owner]):not([data-style-owner="' + owner + '"])';
            css = css.slice(0, token.start) + replacement + css.slice(token.end);
        }
        styles.push({ id: owner, css });
    }
    return styles;
}

// Remove only the old attribute prefixes, preserving the shared character IDs.
// Concurrent clients can perform these same deletions without duplicating text.
function legacySideDeletions(css: string): { index: number; length: number }[] {
    return styleBlocks(css, true).flatMap((block) => block.tokens).flatMap((token) => {
        const match = /^(\[\s*data-)(video-|message-)/i.exec(css.slice(token.start, token.end));
        return match ? [{ index: token.start + match[1].length, length: match[2].length }] : [];
    }).sort((a, b) => b.index - a.index);
}

export function normalizeRoomStyleSelectors(css: string): string {
    for (const deletion of legacySideDeletions(css)) {
        css = css.slice(0, deletion.index) + css.slice(deletion.index + deletion.length);
    }
    return css;
}

function migrateSideEntries(entries: string[]): void {
    for (const deletion of legacySideDeletions(readTextEntries(entries))) {
        entries.splice(deletion.index, deletion.length);
    }
}

function ownershipTokens(css: string, start: number, end: number, migrateLegacy: boolean): OwnershipToken[] {
    const tokens: OwnershipToken[] = [];
    for (let index = start; index < end; index += 1) {
        if (css[index] === "/" && css[index + 1] === "*") {
            const close = css.indexOf("*/", index + 2);
            if (close < 0) break;
            index = close + 1;
        } else if (css[index] === '"' || css[index] === "'") {
            index = stringEnd(css, index);
        } else if (css[index] === "[") {
            let close = index + 1;
            for (; close < end && css[close] !== "]"; close += 1) {
                if (css[close] === '"' || css[close] === "'") close = stringEnd(css, close);
                else if (css[close] === "\\") close += 1;
            }
            const attribute = css.slice(index, close + 1);
            const pattern = migrateLegacy
                ? /^\[\s*data-(?:(?:video|message)-)?side\s*=\s*(?:"(own|other)"|'(own|other)'|(own|other))\s*(?:[is]\s*)?\]$/i
                : /^\[\s*data-side\s*=\s*(?:"(own|other)"|'(own|other)'|(own|other))\s*(?:[is]\s*)?\]$/i;
            const match = pattern.exec(attribute);
            if (match) tokens.push({ start: index, end: close + 1, side: (match[1] ?? match[2] ?? match[3]).toLowerCase() as "own" | "other" });
            index = close;
        }
    }
    return tokens;
}

function stringEnd(css: string, start: number): number {
    for (let index = start + 1; index < css.length; index += 1) {
        if (css[index] === "\\") index += 1;
        else if (css[index] === css[start]) return index;
    }
    return css.length - 1;
}

function styleBlocks(css: string, migrateLegacy = false): StyleBlock[] {
    const blocks: StyleBlock[] = [];
    let start = 0;
    let statementStart = 0;
    let depth = 0;
    let parentheses = 0;
    let tokens: OwnershipToken[] = [];
    function finish(end: number) {
        blocks.push({ start, end, tokens });
        start = end;
        statementStart = end;
        tokens = [];
    }
    for (let index = 0; index < css.length; index += 1) {
        const character = css[index];
        if (character === "/" && css[index + 1] === "*") {
            const close = css.indexOf("*/", index + 2);
            if (close < 0) break;
            index = close + 1;
        } else if (character === '"' || character === "'") {
            index = stringEnd(css, index);
        } else if (character === "\\") {
            index += 1;
        } else if (character === "(") {
            parentheses += 1;
        } else if (character === ")") {
            parentheses = Math.max(0, parentheses - 1);
        } else if (parentheses === 0 && character === "{") {
            tokens.push(...ownershipTokens(css, statementStart, index, migrateLegacy));
            depth += 1;
            statementStart = index + 1;
        } else if (parentheses === 0 && character === "}") {
            depth = Math.max(0, depth - 1);
            statementStart = index + 1;
            if (depth === 0) finish(index + 1);
        } else if (parentheses === 0 && character === ";") {
            statementStart = index + 1;
            if (depth === 0) finish(index + 1);
        }
    }
    if (start < css.length) {
        if (depth === 0) tokens.push(...ownershipTokens(css, statementStart, css.length, migrateLegacy));
        finish(css.length);
    }
    return blocks;
}

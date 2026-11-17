import type { CollaborativeCodeDocument } from "./collaborative-code.ts";
import { createTextEntries, readTextEntries, mergeTextEntrySplices, mapSelectionByIdentity, type SharedTextMerge } from "./shared-text-entries.ts";

import { computeTextSplice, type TextSelection, type TextSplice } from "./collaborative-text.ts";

export const OWNED_ROOM_STYLE_CHANNEL = "room-style:v3";
export const MAX_STORED_ROOM_CSS_LENGTH = 400_000;

interface Ownership {
    template: string;
    people: Record<string, { entries: string[] }>;
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
    for (const block of styleBlocks(css)) {
        const target = block.tokens.length > 0 ? personal : shared;
        for (let index = block.start; index < block.end; index += 1) target.push(entries[index]);
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
        document.ownership = { template: readTextEntries(parts.personal), people: {} };
        document.entries = parts.shared;
    }
    if (hasOwnedStyle(document, owner)) return;
    const used = document.entries.length + Object.values(document.ownership.people).reduce((total, person) => total + person.entries.length, 0);
    const template = used + document.ownership.template.length <= MAX_STORED_ROOM_CSS_LENGTH ? document.ownership.template : "";
    document.ownership.people[owner] = { entries: createTextEntries(template, prefix()) };
}

export function projectOwnedStyle(document: OwnedStyleDocument, owner: string): string[] {
    return [...document.entries, ...(document.ownership?.people[owner]?.entries ?? [])];
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
    const person = document.ownership?.people[owner];
    const visible = projectOwnedStyle(document, owner);
    if (!person) return { accepted: false, entries: visible, operations: [], selection, text: readTextEntries(visible) };
    const intended = mergeTextEntrySplices(base, base, splices, selection, prefix, maxLength);
    const before = partition(base);
    const after = partition(intended.entries);
    const combined = [...after.shared, ...after.personal];
    const position = mapSelectionByIdentity(intended.entries, combined, intended.selection);
    const boundary = after.shared.length;
    const sharedSelection = { ...position, start: Math.min(position.start, boundary), end: Math.min(position.end, boundary) };
    const personalSelection = { ...position, start: Math.max(0, position.start - boundary), end: Math.max(0, position.end - boundary) };
    // Merge the two text arrays independently so a paste cannot overwrite another writer's CSS.
    function merge(previous: string[], next: string[], live: string[], selected: TextSelection) {
        const splice = computeTextSplice(readTextEntries(previous), readTextEntries(next));
        return mergeTextEntrySplices(previous, live, splice ? [splice] : [], selected, prefix, maxLength);
    }
    const shared = merge(before.shared, after.shared, document.entries, sharedSelection);
    const personal = merge(before.personal, after.personal, person.entries, personalSelection);
    const otherLength = Object.entries(document.ownership!.people).reduce((total, [id, value]) => total + (id === owner ? 0 : value.entries.length), 0);
    if (shared.entries.length + personal.entries.length + otherLength > MAX_STORED_ROOM_CSS_LENGTH) {
        return { accepted: false, entries: visible, operations: [], selection: mapSelectionByIdentity(base, visible, selection), text: readTextEntries(visible) };
    }
    for (const operation of shared.operations) document.entries.splice(operation.index, operation.deleteCount, ...operation.insert);
    for (const operation of personal.operations) person.entries.splice(operation.index, operation.deleteCount, ...operation.insert);
    const entries = [...shared.entries, ...personal.entries];
    return {
        accepted: true,
        entries,
        operations: [...shared.operations, ...personal.operations],
        selection: {
            direction: position.direction,
            start: position.start <= boundary ? shared.selection.start : shared.entries.length + personal.selection.start,
            end: position.end <= boundary ? shared.selection.end : shared.entries.length + personal.selection.end,
        },
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

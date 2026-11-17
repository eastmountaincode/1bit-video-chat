import type { TextSelection } from "./collaborative-text.ts";
import { createTextEntries, mapSelectionByIdentity, readTextEntries, type EntrySplice } from "./shared-text-entries.ts";

/** Reapply only the changed character IDs, preserving unrelated live edits. */
export function mergeEntryChanges(before: string[], after: string[], live: string[]) {
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    const removed = new Set(before.filter((entry) => !afterSet.has(entry)));
    const entries = [...live];
    const operations: EntrySplice[] = [];
    for (let end = entries.length; end > 0;) {
        if (!removed.has(entries[end - 1])) { end -= 1; continue; }
        let start = end - 1;
        while (start > 0 && removed.has(entries[start - 1])) start -= 1;
        operations.push({ index: start, deleteCount: end - start, insert: [] });
        entries.splice(start, end - start);
        end = start;
    }

    const surviving = new Set(entries);
    const insertions = new Map<string | null, string[]>();
    let anchor: string | null = null;
    let pending: string[] = [];
    // The next surviving character anchors each restoration. Characters removed
    // by another writer are never restored merely because they were in a snapshot.
    function flush() {
        if (pending.length) insertions.set(anchor, pending.reverse());
        pending = [];
    }
    for (let index = after.length - 1; index >= 0; index -= 1) {
        const entry = after[index];
        if (surviving.has(entry)) {
            flush();
            anchor = entry;
        } else if (!beforeSet.has(entry)) {
            pending.push(entry);
        }
    }
    flush();

    const output: string[] = [];
    for (const entry of entries) {
        const inserted = insertions.get(entry);
        if (inserted?.length) {
            operations.push({ index: output.length, deleteCount: 0, insert: inserted });
            output.push(...inserted);
        }
        output.push(entry);
    }
    const trailing = insertions.get(null);
    if (trailing?.length) {
        operations.push({ index: output.length, deleteCount: 0, insert: trailing });
        output.push(...trailing);
    }
    return { entries: output, operations };
}

interface HistoryItem {
    before: string[];
    after: string[];
    beforeSelection: TextSelection;
    afterSelection: TextSelection;
    group: string | null;
    time: number;
}

export type HistoryDirection = "undo" | "redo";

export class CodeEditorHistory {
    private undoItems: HistoryItem[] = [];
    private redoItems: HistoryItem[] = [];
    private canGroup = false;

    clear() {
        this.undoItems = [];
        this.redoItems = [];
        this.canGroup = false;
    }

    breakGroup() { this.canGroup = false; }

    record(before: string[], after: string[], beforeSelection: TextSelection, afterSelection: TextSelection, group: string | null = null, time = Date.now()) {
        if (before.length === after.length && before.every((entry, index) => entry === after[index])) return;
        const previous = this.undoItems.at(-1);
        const combine = this.canGroup && group && previous?.group === group && time - previous.time < 1000 &&
            beforeSelection.start === beforeSelection.end && previous.afterSelection.start === beforeSelection.start &&
            previous.afterSelection.end === beforeSelection.end &&
            previous.after.length === before.length && previous.after.every((entry, index) => entry === before[index]);
        if (combine && previous) {
            previous.after = [...after];
            previous.afterSelection = { ...afterSelection };
            previous.time = time;
        } else {
            this.undoItems.push({ before: [...before], after: [...after], beforeSelection: { ...beforeSelection }, afterSelection: { ...afterSelection }, group, time });
        }
        this.redoItems = [];
        this.canGroup = Boolean(group);
        // Bound long sessions, including rooms containing large image data URLs.
        let size = this.undoItems.reduce((total, item) => total + item.before.length + item.after.length, 0);
        while (this.undoItems.length > 1 && (this.undoItems.length > 100 || size > 1_000_000)) {
            const removed = this.undoItems.shift()!;
            size -= removed.before.length + removed.after.length;
        }
    }

    plan(direction: HistoryDirection, live: string[], maxLength: number, prefix: () => string) {
        const item = (direction === "undo" ? this.undoItems : this.redoItems).at(-1);
        if (!item) return null;
        const from = direction === "undo" ? item.after : item.before;
        const to = direction === "undo" ? item.before : item.after;
        const selected = direction === "undo" ? item.beforeSelection : item.afterSelection;
        const result = mergeEntryChanges(from, to, live);
        if (result.entries.length > maxLength) return null;
        // Restorations are new CRDT insertions. Fresh IDs avoid duplicate IDs if
        // two disconnected writers undo deletions of the same original text.
        const existing = new Set(live);
        const restored = result.entries.filter((entry) => !existing.has(entry));
        const fresh = createTextEntries(readTextEntries(restored), prefix());
        const replacements = new Map(restored.map((entry, index) => [entry, fresh[index]]));
        const replace = (entry: string) => replacements.get(entry) ?? entry;
        const entries = result.entries.map(replace);
        return {
            entries,
            operations: result.operations.map((operation) => ({ ...operation, insert: operation.insert.map(replace) })),
            selection: mapSelectionByIdentity(to.map(replace), entries, selected),
            replacements,
        };
    }

    complete(direction: HistoryDirection, replacements: Map<string, string>) {
        // Older actions must follow restored characters through further undo/redo.
        for (const item of [...this.undoItems, ...this.redoItems]) {
            item.before = item.before.map((entry) => replacements.get(entry) ?? entry);
            item.after = item.after.map((entry) => replacements.get(entry) ?? entry);
        }
        const source = direction === "undo" ? this.undoItems : this.redoItems;
        const target = direction === "undo" ? this.redoItems : this.undoItems;
        const item = source.pop();
        if (item) target.push(item);
        this.breakGroup();
    }
}

import assert from "node:assert/strict";
import test from "node:test";
import { CodeEditorHistory, mergeEntryChanges, type HistoryDirection } from "./code-editor-history.ts";
import { createTextEntries, readTextEntries } from "./shared-text-entries.ts";

let sequence = 0;
const prefix = () => `history-${sequence++}`;
const entries = (text: string) => createTextEntries(text, prefix());
const caret = (start: number) => ({ start, end: start, direction: "none" as const });

function step(history: CodeEditorHistory, direction: HistoryDirection, live: string[]) {
    const plan = history.plan(direction, live, 20_000, prefix);
    assert.ok(plan);
    history.complete(direction, plan.replacements);
    return plan;
}

test("typing groups into one undo step, and redo restores text and selection", () => {
    const history = new CodeEditorHistory();
    const first = entries("r");
    const second = [...first, ...entries("e")];
    const third = [...second, ...entries("d")];
    history.record([], first, caret(0), caret(1), "insertText", 100);
    history.record(first, second, caret(1), caret(2), "insertText", 200);
    history.record(second, third, caret(2), caret(3), "insertText", 300);
    const undo = step(history, "undo", third);
    assert.equal(readTextEntries(undo.entries), "");
    assert.equal(undo.selection.start, 0);
    assert.equal(history.plan("undo", undo.entries, 20_000, prefix), null);
    const redo = step(history, "redo", undo.entries);
    assert.equal(readTextEntries(redo.entries), "red");
    assert.equal(redo.selection.start, 3);
});

test("undo and redo preserve another writer's insertion inside a local paste", () => {
    const history = new CodeEditorHistory();
    const base = entries("{}");
    const own = entries("red");
    const after = [base[0], ...own, base[1]];
    history.record(base, after, caret(1), caret(4));
    const remote = entries("blue");
    const live = [base[0], own[0], ...remote, ...own.slice(1), base[1]];
    const undone = step(history, "undo", live);
    assert.equal(readTextEntries(undone.entries), "{blue}");
    const redone = step(history, "redo", undone.entries);
    assert.equal(readTextEntries(redone.entries).replace("blue", ""), "{red}");
    for (const entry of remote) assert.ok(redone.entries.includes(entry));
});

test("restored characters remain undoable through earlier edits and repeated redo", () => {
    const history = new CodeEditorHistory();
    const word = entries("red");
    history.record([], word, caret(0), caret(3));
    history.record(word, [], caret(3), caret(0));
    const restored = step(history, "undo", []).entries;
    assert.equal(readTextEntries(restored), "red");
    assert.notEqual(restored[0], word[0]);
    const removed = step(history, "undo", restored).entries;
    assert.deepEqual(removed, []);
    const redone = step(history, "redo", removed).entries;
    assert.equal(readTextEntries(redone), "red");
    assert.deepEqual(step(history, "redo", redone).entries, []);
});

test("remote deletions are not undone and redo is cleared by a new local edit", () => {
    const history = new CodeEditorHistory();
    const base = entries("abc");
    const own = entries("X");
    const after = [...base, ...own];
    history.record(base, after, caret(3), caret(4));
    const undone = step(history, "undo", [...base.slice(1), ...own]).entries;
    assert.equal(readTextEntries(undone), "bc");
    const fresh = [...undone, ...entries("Y")];
    history.record(undone, fresh, caret(2), caret(3));
    assert.equal(history.plan("redo", fresh, 20_000, prefix), null);
    history.clear();
    assert.equal(history.plan("undo", fresh, 20_000, prefix), null);
});

test("paste, selection movement and pauses keep separate undo steps", () => {
    const history = new CodeEditorHistory();
    const a = entries("a");
    const b = [...a, ...entries("b")];
    const pasted = [...b, ...entries("paste")];
    history.record([], a, caret(0), caret(1), "insertText", 100);
    history.record(a, b, caret(1), caret(2), "insertText", 1500);
    history.record(b, pasted, caret(2), caret(7), null, 1600);
    const first = step(history, "undo", pasted).entries;
    assert.equal(readTextEntries(first), "ab");
    const second = step(history, "undo", first).entries;
    assert.equal(readTextEntries(second), "a");
    assert.equal(readTextEntries(step(history, "undo", second).entries), "");
});

test("restoring deleted text respects the editor limit without consuming history", () => {
    const history = new CodeEditorHistory();
    const base = entries("deleted");
    history.record(base, [], caret(7), caret(0));
    const remote = entries("remote");
    assert.equal(history.plan("undo", remote, 8, prefix), null);
    assert.ok(history.plan("undo", remote, 20_000, prefix));
});

test("entry changes produce operations matching the merged result", () => {
    const before = entries("abcdef");
    const after = [...before.slice(0, 2), ...entries("X"), before[4], ...entries("Y")];
    const remote = entries("remote");
    const live = [...before.slice(0, 3), ...remote, ...before.slice(3)];
    const result = mergeEntryChanges(before, after, live);
    const applied = [...live];
    for (const operation of result.operations) applied.splice(operation.index, operation.deleteCount, ...operation.insert);
    assert.deepEqual(applied, result.entries);
    assert.equal(readTextEntries(result.entries), "abremoteXeY");
});

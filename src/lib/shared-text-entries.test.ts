import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";

import {
  createTextEntries,
  mapSelectionByIdentity,
  mergeTextEntrySplices,
  readTextEntries,
  readTextEntriesSafely,
} from "./shared-text-entries.ts";
import { changeTextIndentation } from "./text-indentation.ts";

test("rejects malformed or ambiguous shared entries without throwing", () => {
  assert.equal(readTextEntriesSafely(["bad"]), null);
  assert.equal(
    readTextEntriesSafely(["same\u0000a", "same\u0000b"]),
    null,
  );
  assert.equal(readTextEntriesSafely(["id\u0000ab"]), null);
});

test("two stale users deleting the same logical space delete it once", () => {
  const base = createTextEntries("  ", "base");
  const live = base.slice(1);
  const result = mergeTextEntrySplices(
    base,
    live,
    [{ index: 0, deleteCount: 1, insert: "" }],
    caretAt(0),
    () => "local",
    20_000,
  );

  assert.equal(result.text, " ");
});

test("a stale deletion never consumes a remote insertion with equal CSS characters", () => {
  const base = createTextEntries("  color", "base");
  const live = [...createTextEntries(" X", "remote"), ...base];
  const result = mergeTextEntrySplices(
    base,
    live,
    [{ index: 0, deleteCount: 1, insert: "" }],
    caretAt(0),
    () => "local",
    20_000,
  );

  assert.equal(result.text, " X color");
});

test("the caret stays attached to the surviving character after a remote deletion", () => {
  const base = createTextEntries("  ", "base");
  const live = base.slice(1);

  assert.deepEqual(
    mapSelectionByIdentity(base, live, caretAt(1)),
    caretAt(0),
  );
});

test("an unchanged character remains editable across large disjoint changes", () => {
  const base = createTextEntries(
    `${"L".repeat(600)}M${"R".repeat(600)}`,
    "base",
  );
  const live = [
    ...createTextEntries("X".repeat(600), "remote-left"),
    base[600],
    ...createTextEntries("Y".repeat(600), "remote-right"),
  ];
  const result = mergeTextEntrySplices(
    base,
    live,
    [{ index: 600, deleteCount: 1, insert: "" }],
    caretAt(600),
    () => "local",
    20_000,
  );

  assert.equal(result.text, `${"X".repeat(600)}${"Y".repeat(600)}`);
  assert.deepEqual(result.selection, caretAt(600));
});

test("20 stale editors preserve every same-position insertion", () => {
  const base = createTextEntries(":root {\n}\n", "base");
  let live = [...base];
  const insertAt = readTextEntries(base).indexOf("}");

  for (let index = 0; index < 20; index += 1) {
    const marker = `  --user-${index.toString().padStart(2, "0")}: 1;\n`;
    const result = mergeTextEntrySplices(
      base,
      live,
      [{ index: insertAt, deleteCount: 0, insert: marker }],
      caretAt(insertAt + marker.length),
      () => `user-${index}`,
      20_000,
    );
    live = result.entries;
  }

  const text = readTextEntries(live);
  for (let index = 0; index < 20; index += 1) {
    assert.equal(
      text.split(`--user-${index.toString().padStart(2, "0")}: 1;`)
        .length - 1,
      1,
    );
  }
});

test("20 delayed editors preserve every insertion within the local test budget", (context) => {
  const before = `/* ${"x".repeat(18_950)} */`;
  const base = createTextEntries(before, "base");
  let live = [...base];
  const startedAt = performance.now();

  for (let index = 0; index < 20; index += 1) {
    const marker = `\n/* participant ${index.toString().padStart(2, "0")} */`;
    live = mergeTextEntrySplices(
      base,
      live,
      [{ index: base.length, deleteCount: 0, insert: marker }],
      caretAt(base.length + marker.length),
      () => `participant-${index}`,
      20_000,
    ).entries;
  }

  const elapsedMs = performance.now() - startedAt;
  context.diagnostic(`20 delayed editors merged in ${elapsedMs.toFixed(1)} ms`);
  assert.ok(live.length <= 20_000);
  for (let index = 0; index < 20; index += 1) {
    assert.match(
      readTextEntries(live),
      new RegExp(`participant ${index.toString().padStart(2, "0")}`),
    );
  }
});

test("truncates an insertion exactly at the shared length boundary", () => {
  const base = createTextEntries("x".repeat(19_990), "base");
  const result = mergeTextEntrySplices(
    base,
    base,
    [{ index: base.length, deleteCount: 0, insert: "0123456789abcdefghij" }],
    caretAt(base.length + 20),
    () => "local",
    20_000,
  );

  assert.equal(result.entries.length, 20_000);
  assert.equal(result.text.slice(-10), "0123456789");
  assert.deepEqual(result.selection, caretAt(20_000));
});

test("indents 5,000 selected lines without quadratic merging", (context) => {
  const before = "x\n".repeat(5_000);
  const base = createTextEntries(before, "base");
  const edit = changeTextIndentation(
    before,
    {
      direction: "forward",
      start: 0,
      end: before.length,
    },
    false,
  );
  const startedAt = performance.now();
  let prefixIndex = 0;
  const result = mergeTextEntrySplices(
    base,
    base,
    edit.splices,
    edit.selection,
    () => `indent-${prefixIndex++}`,
    20_000,
  );
  const elapsedMs = performance.now() - startedAt;

  context.diagnostic(
    `5,000-line identity merge completed in ${elapsedMs.toFixed(1)} ms`,
  );
  assert.equal(result.text, edit.value);
  assert.equal(readTextEntriesSafely(result.entries), result.text);
  assert.ok(elapsedMs < 500);
});

function caretAt(position: number) {
  return {
    direction: "none" as const,
    end: position,
    start: position,
  };
}

import assert from "node:assert/strict";
import test from "node:test";

import { resolveEditorSelection } from "./editor-selection.ts";

test("a queued selection wins over a transient end-of-text DOM selection", () => {
  const pending = caretAt(28);
  const transientDomSelection = caretAt(800);

  assert.deepEqual(
    resolveEditorSelection(
      pending,
      transientDomSelection,
      caretAt(25),
    ),
    pending,
  );
});

test("a focused DOM selection is used for a remote update when none is queued", () => {
  const focused = caretAt(125);

  assert.deepEqual(
    resolveEditorSelection(null, focused, caretAt(80)),
    focused,
  );
});

test("an unfocused editor falls back to its remembered selection", () => {
  const remembered = caretAt(64);

  assert.deepEqual(
    resolveEditorSelection(null, null, remembered),
    remembered,
  );
});

function caretAt(position: number) {
  return {
    direction: "none" as const,
    end: position,
    start: position,
  };
}

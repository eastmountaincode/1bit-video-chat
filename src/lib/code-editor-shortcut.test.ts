import assert from "node:assert/strict";
import test from "node:test";

import { getCodeEditorShortcut } from "./code-editor-shortcut.ts";

const baseKeyboardEvent = {
  altKey: false,
  code: "",
  ctrlKey: false,
  isComposing: false,
  key: "",
  metaKey: false,
};

test("recognizes Control and Command run shortcuts", () => {
  assert.equal(
    getCodeEditorShortcut({
      ...baseKeyboardEvent,
      ctrlKey: true,
      key: "Enter",
    }),
    "run",
  );
  assert.equal(
    getCodeEditorShortcut({
      ...baseKeyboardEvent,
      key: "Enter",
      metaKey: true,
    }),
    "run",
  );
});

test("recognizes Control and Command stop shortcuts", () => {
  assert.equal(
    getCodeEditorShortcut({
      ...baseKeyboardEvent,
      code: "Period",
      ctrlKey: true,
      key: ".",
    }),
    "stop",
  );
  assert.equal(
    getCodeEditorShortcut({
      ...baseKeyboardEvent,
      code: "Period",
      key: "Unidentified",
      metaKey: true,
    }),
    "stop",
  );
});

test("does not consume plain, Alt-modified, or composing keys", () => {
  assert.equal(
    getCodeEditorShortcut({
      ...baseKeyboardEvent,
      key: "Enter",
    }),
    null,
  );
  assert.equal(
    getCodeEditorShortcut({
      ...baseKeyboardEvent,
      altKey: true,
      ctrlKey: true,
      key: "Enter",
    }),
    null,
  );
  assert.equal(
    getCodeEditorShortcut({
      ...baseKeyboardEvent,
      ctrlKey: true,
      isComposing: true,
      key: "Enter",
    }),
    null,
  );
});

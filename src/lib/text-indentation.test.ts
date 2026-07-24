import assert from "node:assert/strict";
import test from "node:test";

import {
  insertLineBreakWithIndentation,
  type TextIndentationEdit,
} from "./text-indentation.ts";

test("continues the current line's leading spaces", () => {
  const value = "selector {\n  color: red;";
  const edit = insertLineBreakWithIndentation(
    value,
    caretAt(value.length),
  );

  assert.deepEqual(edit, {
    value: `${value}\n  `,
    selection: caretAt(value.length + 3),
    splices: [
      {
        index: value.length,
        deleteCount: 0,
        insert: "\n  ",
      },
    ],
  } satisfies TextIndentationEdit);
});

test("preserves mixed tabs and spaces without guessing CSS structure", () => {
  const value = "\t  selector {";
  const edit = insertLineBreakWithIndentation(
    value,
    caretAt(value.length),
  );

  assert.equal(edit.value, `${value}\n\t  `);
  assert.deepEqual(edit.selection, caretAt(edit.value.length));
});

test("keeps the caret's column when splitting inside indentation", () => {
  const value = "    color: red;";
  const edit = insertLineBreakWithIndentation(value, caretAt(2));

  assert.equal(edit.value, "  \n    color: red;");
  assert.deepEqual(edit.selection, caretAt(5));
});

test("replaces a selection with one correctly indented line break", () => {
  const value = "  one two";
  const edit = insertLineBreakWithIndentation(value, {
    start: 6,
    end: 9,
    direction: "forward",
  });

  assert.deepEqual(edit, {
    value: "  one \n  ",
    selection: {
      start: 9,
      end: 9,
      direction: "forward",
    },
    splices: [
      {
        index: 6,
        deleteCount: 3,
        insert: "\n  ",
      },
    ],
  } satisfies TextIndentationEdit);
});

test("adds only a line break on an unindented line", () => {
  const value = "color: red;";
  const edit = insertLineBreakWithIndentation(
    value,
    caretAt(value.length),
  );

  assert.equal(edit.value, `${value}\n`);
  assert.deepEqual(edit.selection, caretAt(edit.value.length));
});

test("continues indentation on a whitespace-only line", () => {
  const value = "  ";
  const edit = insertLineBreakWithIndentation(
    value,
    caretAt(value.length),
  );

  assert.equal(edit.value, "  \n  ");
  assert.deepEqual(edit.selection, caretAt(edit.value.length));
});

test("prioritizes the line break when the length limit cannot fit indentation", () => {
  const value = "  ab";
  const edit = insertLineBreakWithIndentation(
    value,
    {
      start: 3,
      end: 4,
      direction: "forward",
    },
    value.length,
  );

  assert.deepEqual(edit, {
    value: "  a\n",
    selection: {
      start: 4,
      end: 4,
      direction: "forward",
    },
    splices: [
      {
        index: 3,
        deleteCount: 1,
        insert: "\n",
      },
    ],
  } satisfies TextIndentationEdit);
});

function caretAt(position: number) {
  return {
    start: position,
    end: position,
    direction: "none" as const,
  };
}

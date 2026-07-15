import {
  applyTextSplice,
  mapSelectionThroughSplice,
  type TextSelection,
  type TextSplice,
} from "@/lib/collaborative-text";

export const CSS_INDENT = "  ";

export interface TextIndentationEdit {
  selection: TextSelection;
  splices: TextSplice[];
  value: string;
}

export function changeTextIndentation(
  value: string,
  selection: TextSelection,
  outdent: boolean,
): TextIndentationEdit {
  const isCollapsed = selection.start === selection.end;

  if (!outdent && isCollapsed) {
    return applySplices(value, selection, [
      {
        index: selection.start,
        deleteCount: 0,
        insert: CSS_INDENT,
      },
    ]);
  }

  const lineStarts = getSelectedLineStarts(value, selection);
  const splices = lineStarts
    .map((index): TextSplice | null => {
      if (!outdent) {
        return { index, deleteCount: 0, insert: CSS_INDENT };
      }

      const deleteCount = getIndentLength(value, index);
      return deleteCount > 0
        ? { index, deleteCount, insert: "" }
        : null;
    })
    .filter((splice): splice is TextSplice => splice !== null)
    .reverse();

  return applySplices(value, selection, splices);
}

function applySplices(
  value: string,
  selection: TextSelection,
  splices: TextSplice[],
): TextIndentationEdit {
  let nextValue = value;
  let nextSelection = selection;

  for (const splice of splices) {
    nextValue = applyTextSplice(nextValue, splice);
    nextSelection = mapSelectionThroughSplice(nextSelection, splice);
  }

  return { value: nextValue, selection: nextSelection, splices };
}

function getSelectedLineStarts(value: string, selection: TextSelection) {
  const firstLineStart = value.lastIndexOf("\n", selection.start - 1) + 1;
  const effectiveEnd =
    selection.end > selection.start && value[selection.end - 1] === "\n"
      ? selection.end - 1
      : selection.end;
  const lineStarts = [firstLineStart];
  let newlineIndex = value.indexOf("\n", firstLineStart);

  while (newlineIndex >= 0 && newlineIndex < effectiveEnd) {
    lineStarts.push(newlineIndex + 1);
    newlineIndex = value.indexOf("\n", newlineIndex + 1);
  }

  return lineStarts;
}

function getIndentLength(value: string, lineStart: number) {
  if (value[lineStart] === "\t") return 1;

  let length = 0;
  while (length < CSS_INDENT.length && value[lineStart + length] === " ") {
    length += 1;
  }

  return length;
}

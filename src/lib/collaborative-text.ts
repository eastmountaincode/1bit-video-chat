/**
 * One contiguous textarea edit. Offsets use UTF-16 code units, matching
 * selectionStart, selectionEnd, and String#length.
 */
export type TextSplice = {
  index: number;
  deleteCount: number;
  insert: string;
};

export type TextAffinity = "before" | "after";

export type TextSelection = {
  start: number;
  end: number;
  direction?: "forward" | "backward" | "none";
};

export type SelectionMapOptions = {
  startAffinity?: TextAffinity;
  endAffinity?: TextAffinity;
  collapsedAffinity?: TextAffinity;
};

/** Finds the smallest single splice that changes `before` to `after`. */
export function computeTextSplice(
  before: string,
  after: string,
): TextSplice | null {
  if (before === after) return null;

  const sharedLimit = Math.min(before.length, after.length);
  let prefixLength = 0;
  while (
    prefixLength < sharedLimit &&
    before.charCodeAt(prefixLength) === after.charCodeAt(prefixLength)
  ) {
    prefixLength += 1;
  }

  const suffixLimit = Math.min(
    before.length - prefixLength,
    after.length - prefixLength,
  );
  let suffixLength = 0;
  while (
    suffixLength < suffixLimit &&
    before.charCodeAt(before.length - suffixLength - 1) ===
      after.charCodeAt(after.length - suffixLength - 1)
  ) {
    suffixLength += 1;
  }

  return {
    index: prefixLength,
    deleteCount: before.length - prefixLength - suffixLength,
    insert: after.slice(prefixLength, after.length - suffixLength),
  };
}

export function applyTextSplice(text: string, splice: TextSplice) {
  assertSplice(splice, text.length);
  return (
    text.slice(0, splice.index) +
    splice.insert +
    text.slice(splice.index + splice.deleteCount)
  );
}

export function mapTextPositionThroughSplice(
  position: number,
  splice: TextSplice,
  affinity: TextAffinity = "after",
) {
  assertOffset(position, "position");
  assertSplice(splice);

  const oldEnd = splice.index + splice.deleteCount;
  const newEnd = splice.index + splice.insert.length;

  if (position < splice.index) return position;
  if (position > oldEnd) {
    return position + splice.insert.length - splice.deleteCount;
  }
  if (splice.deleteCount > 0 && position === oldEnd) return newEnd;
  return affinity === "before" ? splice.index : newEnd;
}

export function mapSelectionThroughSplice(
  selection: TextSelection,
  splice: TextSplice,
  options: SelectionMapOptions = {},
): TextSelection {
  assertSelection(selection);

  if (selection.start === selection.end) {
    const position = mapTextPositionThroughSplice(
      selection.start,
      splice,
      options.collapsedAffinity ?? "after",
    );
    return { ...selection, start: position, end: position };
  }

  const start = mapTextPositionThroughSplice(
    selection.start,
    splice,
    options.startAffinity ?? "after",
  );
  const mappedEnd = mapTextPositionThroughSplice(
    selection.end,
    splice,
    options.endAffinity ?? "before",
  );

  return { ...selection, start, end: Math.max(start, mappedEnd) };
}

function assertSelection(selection: TextSelection) {
  assertOffset(selection.start, "selection.start");
  assertOffset(selection.end, "selection.end");
  if (selection.end < selection.start) {
    throw new RangeError("selection.end must be greater than or equal to start");
  }
}

function assertSplice(splice: TextSplice, textLength?: number) {
  assertOffset(splice.index, "splice.index");
  assertOffset(splice.deleteCount, "splice.deleteCount");
  if (typeof splice.insert !== "string") {
    throw new TypeError("splice.insert must be a string");
  }
  if (
    textLength !== undefined &&
    splice.index + splice.deleteCount > textLength
  ) {
    throw new RangeError("splice extends past the end of the text");
  }
}

function assertOffset(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

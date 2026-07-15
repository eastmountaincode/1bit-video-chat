/**
 * A single contiguous edit to a JavaScript string.
 *
 * All offsets and lengths in this module are UTF-16 code units, matching
 * String#length, String#slice, and textarea selectionStart/selectionEnd.
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
  /** Whether a non-collapsed selection starts before or after an insertion. */
  startAffinity?: TextAffinity;
  /** Whether a non-collapsed selection ends before or after an insertion. */
  endAffinity?: TextAffinity;
  /** Where a caret lands when another edit occurs exactly at the caret. */
  collapsedAffinity?: TextAffinity;
};

export type RebaseTextSpliceOptions = {
  /**
   * Orders a local insertion relative to a remote insertion at the same
   * position. A caller with stable actor IDs can choose this deterministically.
   */
  insertAffinity?: TextAffinity;
};

export type TextAlignmentOptions = {
  /** Maximum insertions plus deletions explored by the alignment. */
  maxEditDistance?: number;
  /** Soft work limit for alignment frontier steps and matched code units. */
  maxAlignmentWork?: number;
};

export type RebaseTextSpliceOntoTextOptions = RebaseTextSpliceOptions &
  TextAlignmentOptions;

export type SelectionThroughTextChangesOptions = SelectionMapOptions &
  TextAlignmentOptions;

const DEFAULT_MAX_EDIT_DISTANCE = 512;
const DEFAULT_MAX_ALIGNMENT_WORK = 2_000_000;

/**
 * Finds the smallest single contiguous edit that changes `before` to `after`.
 * Returns null when the strings are identical.
 */
export function computeTextSplice(
  before: string,
  after: string,
): TextSplice | null {
  if (before === after) {
    return null;
  }

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

/** Applies a valid splice to a string. */
export function applyTextSplice(text: string, splice: TextSplice): string {
  assertSplice(splice, text.length);

  return (
    text.slice(0, splice.index) +
    splice.insert +
    text.slice(splice.index + splice.deleteCount)
  );
}

/**
 * Maps one UTF-16 position from the text before `splice` to the text after it.
 * Affinity only matters when the old position touches or falls inside the
 * replaced range; it chooses the side of newly inserted text.
 */
export function mapTextPositionThroughSplice(
  position: number,
  splice: TextSplice,
  affinity: TextAffinity = "after",
): number {
  assertOffset(position, "position");
  assertSplice(splice);

  const oldEnd = splice.index + splice.deleteCount;
  const newEnd = splice.index + splice.insert.length;

  if (position < splice.index) {
    return position;
  }

  if (position > oldEnd) {
    return position + splice.insert.length - splice.deleteCount;
  }

  // The end of a non-empty deletion is the boundary after the replacement.
  // Unlike a pure insertion boundary, it unambiguously follows inserted text.
  if (splice.deleteCount > 0 && position === oldEnd) {
    return newEnd;
  }

  return affinity === "before" ? splice.index : newEnd;
}

/**
 * Maps textarea-style selection offsets through an edit.
 *
 * By default, a caret follows an insertion made exactly at the caret. A range
 * excludes insertions made exactly at either edge, while insertions inside the
 * range remain selected.
 */
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

    return {
      ...selection,
      start: position,
      end: position,
    };
  }

  const mappedStart = mapTextPositionThroughSplice(
    selection.start,
    splice,
    options.startAffinity ?? "after",
  );
  const mappedEnd = mapTextPositionThroughSplice(
    selection.end,
    splice,
    options.endAffinity ?? "before",
  );

  // A remote replacement can consume the whole old selection and map its
  // differently-affined edges in reverse order. In that case, leave a caret
  // immediately after the replacement instead of manufacturing a new range.
  const start = mappedStart;
  const end = Math.max(mappedStart, mappedEnd);

  return {
    ...selection,
    start,
    end,
  };
}

/**
 * Rebases a local splice (written against the old text) so it can be applied
 * after one remote splice written against that same old text.
 *
 * This intentionally remains a single splice. Consequently, a remote insert
 * strictly inside text deleted by the local edit is absorbed by that deletion;
 * preserving it would require two disjoint splices. Concurrent insert ordering
 * at the same offset is controlled by `insertAffinity`.
 */
export function rebaseTextSplice(
  local: TextSplice,
  remote: TextSplice,
  options: RebaseTextSpliceOptions = {},
): TextSplice | null {
  assertSplice(local);
  assertSplice(remote);

  if (isNoop(local)) {
    return null;
  }

  if (isNoop(remote)) {
    return { ...local };
  }

  const insertAffinity = options.insertAffinity ?? "after";

  if (local.deleteCount === 0) {
    return {
      ...local,
      index: mapTextPositionThroughSplice(
        local.index,
        remote,
        insertAffinity,
      ),
    };
  }

  const mappedStart = mapTextPositionThroughSplice(
    local.index,
    remote,
    insertAffinity,
  );
  const mappedEnd = mapTextPositionThroughSplice(
    local.index + local.deleteCount,
    remote,
    "before",
  );

  // When the remote edit already removed the complete local deletion range,
  // only the local replacement text (if any) remains to apply.
  const deleteCount = Math.max(0, mappedEnd - mappedStart);
  const rebased: TextSplice = {
    index: mappedStart,
    deleteCount,
    insert: local.insert,
  };

  return isNoop(rebased) ? null : rebased;
}

/**
 * Rebases a local edit written against `before` onto an arbitrarily changed
 * `liveText`.
 *
 * Unlike `rebaseTextSplice`, this function can return several edits. It aligns
 * the old and live strings, then deletes only live code units matched to base
 * code units in the local deletion range. Unmatched live code units are
 * treated as concurrent insertions and are never deleted. The returned splices
 * are already ordered for sequential application (right-to-left deletions,
 * followed by the local insertion).
 *
 * If the bounded alignment would be pathologically expensive, the conservative
 * fallback still aligns the proven common prefix and suffix. Local deletions
 * continue to affect those known base characters, but skip the unrecognized
 * changed middle so remote content cannot be erased.
 */
export function rebaseTextSpliceOntoText(
  before: string,
  liveText: string,
  local: TextSplice,
  options: RebaseTextSpliceOntoTextOptions = {},
): TextSplice[] {
  assertSplice(local, before.length);

  if (isNoop(local)) {
    return [];
  }

  const alignment = alignText(before, liveText, options);

  if (!alignment) {
    if (local.insert.length === 0) {
      return [];
    }

    return [
      {
        index: mapBoundaryConservatively(
          before,
          liveText,
          local.index,
          options.insertAffinity ?? "after",
        ),
        deleteCount: 0,
        insert: local.insert,
      },
    ];
  }

  const deletionEnd = local.index + local.deleteCount;
  const deletionRuns: Array<{ index: number; deleteCount: number }> = [];

  for (let baseIndex = local.index; baseIndex < deletionEnd; baseIndex += 1) {
    const liveIndex = alignment.baseToLive[baseIndex];

    if (liveIndex < 0) {
      continue;
    }

    const previousRun = deletionRuns[deletionRuns.length - 1];
    if (
      previousRun &&
      previousRun.index + previousRun.deleteCount === liveIndex
    ) {
      previousRun.deleteCount += 1;
    } else {
      deletionRuns.push({ index: liveIndex, deleteCount: 1 });
    }
  }

  const splices: TextSplice[] = deletionRuns
    .reverse()
    .map((run) => ({ ...run, insert: "" }));

  if (local.insert.length > 0) {
    let insertionIndex = mapBoundaryThroughAlignment(
      alignment,
      local.index,
      options.insertAffinity ?? "after",
    );

    // Usually every deletion is at or to the right of this boundary. Mapping
    // through the returned operations also keeps this correct for ambiguous
    // repeated-text alignments.
    for (const splice of splices) {
      insertionIndex = mapTextPositionThroughSplice(
        insertionIndex,
        splice,
        "before",
      );
    }

    splices.push({
      index: insertionIndex,
      deleteCount: 0,
      insert: local.insert,
    });
  }

  return splices;
}

/**
 * Maps a textarea selection from `before` into `liveText`, including multiple
 * disjoint remote edits. On alignment fallback, positions are kept outside the
 * unrecognized changed region so no remote content is accidentally selected.
 */
export function mapSelectionThroughTextChanges(
  before: string,
  liveText: string,
  selection: TextSelection,
  options: SelectionThroughTextChangesOptions = {},
): TextSelection {
  assertSelection(selection, before.length);

  const alignment = alignText(before, liveText, options);
  const mapBoundary = (position: number, affinity: TextAffinity) =>
    alignment
      ? mapBoundaryThroughAlignment(alignment, position, affinity)
      : mapBoundaryConservatively(before, liveText, position, affinity);

  if (selection.start === selection.end) {
    const position = mapBoundary(
      selection.start,
      options.collapsedAffinity ?? "after",
    );

    return { ...selection, start: position, end: position };
  }

  const start = mapBoundary(
    selection.start,
    options.startAffinity ?? "after",
  );
  const mappedEnd = mapBoundary(
    selection.end,
    options.endAffinity ?? "before",
  );

  return { ...selection, start, end: Math.max(start, mappedEnd) };
}

type TextAlignment = {
  baseToLive: Int32Array;
  boundaryBeforeInsertions: Int32Array;
  boundaryAfterInsertions: Int32Array;
};

/**
 * A bounded Myers alignment. Matches retain base character identity; live code
 * units not in the match are the remote insertions protected by the rebaser.
 */
function alignText(
  before: string,
  liveText: string,
  options: TextAlignmentOptions,
): TextAlignment | null {
  const maxEditDistance = readLimit(
    options.maxEditDistance,
    DEFAULT_MAX_EDIT_DISTANCE,
    "maxEditDistance",
  );
  const maxWork = readLimit(
    options.maxAlignmentWork,
    DEFAULT_MAX_ALIGNMENT_WORK,
    "maxAlignmentWork",
  );
  const beforeLength = before.length;
  const liveLength = liveText.length;

  // Equality is already a complete alignment and should not fall back merely
  // because a caller selected a very small work budget.
  if (before === liveText) {
    return makeAlignment(identityMapping(beforeLength), liveLength);
  }

  const contiguousChange = computeTextSplice(before, liveText);
  // Unequal strings always have a splice. Keeping this guard makes the helper
  // robust if computeTextSplice's no-op representation ever changes.
  if (!contiguousChange) {
    return makeAlignment(identityMapping(beforeLength), liveLength);
  }

  // These are exact O(n) alignments even when the inserted/deleted run is many
  // thousands of code units. They prevent a large paste elsewhere from making
  // an unrelated stale deletion disappear at the Myers distance bound.
  if (
    contiguousChange.deleteCount === 0 ||
    contiguousChange.insert.length === 0
  ) {
    return makeContiguousChangeAlignment(
      beforeLength,
      liveLength,
      contiguousChange,
    );
  }

  if (Math.abs(beforeLength - liveLength) > maxEditDistance) {
    return makeContiguousChangeAlignment(
      beforeLength,
      liveLength,
      contiguousChange,
    );
  }

  const maximumDepth = Math.min(
    beforeLength + liveLength,
    maxEditDistance,
  );
  const trace: Int32Array[] = [];
  let work = 0;

  const initial = new Int32Array(1);
  let initialX = 0;
  while (
    initialX < beforeLength &&
    initialX < liveLength &&
    before.charCodeAt(initialX) === liveText.charCodeAt(initialX)
  ) {
    initialX += 1;
    work += 1;

    if (work > maxWork) {
      return makeContiguousChangeAlignment(
        beforeLength,
        liveLength,
        contiguousChange,
      );
    }
  }
  initial[0] = initialX;
  trace.push(initial);

  if (initialX === beforeLength && initialX === liveLength) {
    return makeAlignment(identityMapping(beforeLength), liveLength);
  }

  for (let depth = 1; depth <= maximumDepth; depth += 1) {
    const previous = trace[depth - 1];
    const frontier = new Int32Array(depth * 2 + 1);
    frontier.fill(-1);

    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      work += 1;
      if (work > maxWork) {
        return makeContiguousChangeAlignment(
          beforeLength,
          liveLength,
          contiguousChange,
        );
      }

      const insertionX = frontierValue(previous, depth - 1, diagonal + 1);
      const deletionX =
        frontierValue(previous, depth - 1, diagonal - 1) + 1;
      let x: number;

      if (
        diagonal === -depth ||
        (diagonal !== depth && deletionX <= insertionX)
      ) {
        x = insertionX;
      } else {
        x = deletionX;
      }

      let y = x - diagonal;
      while (
        x < beforeLength &&
        y < liveLength &&
        before.charCodeAt(x) === liveText.charCodeAt(y)
      ) {
        x += 1;
        y += 1;
        work += 1;

        if (work > maxWork) {
          return makeContiguousChangeAlignment(
            beforeLength,
            liveLength,
            contiguousChange,
          );
        }
      }

      frontier[diagonal + depth] = x;

      if (x >= beforeLength && y >= liveLength) {
        trace.push(frontier);
        return makeAlignment(
          backtrackMatches(trace, beforeLength, liveLength),
          liveLength,
        );
      }
    }

    trace.push(frontier);
  }

  return makeContiguousChangeAlignment(
    beforeLength,
    liveLength,
    contiguousChange,
  );
}

function backtrackMatches(
  trace: Int32Array[],
  beforeLength: number,
  liveLength: number,
): Int32Array {
  const baseToLive = new Int32Array(beforeLength);
  baseToLive.fill(-1);

  let x = beforeLength;
  let y = liveLength;

  for (let depth = trace.length - 1; depth > 0; depth -= 1) {
    const previous = trace[depth - 1];
    const diagonal = x - y;
    const insertionX = frontierValue(previous, depth - 1, diagonal + 1);
    const deletionX =
      frontierValue(previous, depth - 1, diagonal - 1) + 1;
    const previousDiagonal =
      diagonal === -depth ||
      (diagonal !== depth && deletionX <= insertionX)
        ? diagonal + 1
        : diagonal - 1;
    const previousX = frontierValue(previous, depth - 1, previousDiagonal);
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      baseToLive[x] = y;
    }

    if (x === previousX) {
      y -= 1;
    } else {
      x -= 1;
    }
  }

  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    baseToLive[x] = y;
  }

  return baseToLive;
}

function makeAlignment(
  baseToLive: Int32Array,
  liveLength: number,
): TextAlignment {
  const boundaryCount = baseToLive.length + 1;
  const boundaryBeforeInsertions = new Int32Array(boundaryCount);
  const boundaryAfterInsertions = new Int32Array(boundaryCount);

  let previousLiveIndex = -1;
  for (let boundary = 0; boundary < boundaryCount; boundary += 1) {
    boundaryBeforeInsertions[boundary] = previousLiveIndex + 1;
    if (boundary < baseToLive.length && baseToLive[boundary] >= 0) {
      previousLiveIndex = baseToLive[boundary];
    }
  }

  let nextLiveIndex = liveLength;
  for (let boundary = boundaryCount - 1; boundary >= 0; boundary -= 1) {
    if (boundary < baseToLive.length && baseToLive[boundary] >= 0) {
      nextLiveIndex = baseToLive[boundary];
    }
    boundaryAfterInsertions[boundary] = nextLiveIndex;
  }

  return {
    baseToLive,
    boundaryBeforeInsertions,
    boundaryAfterInsertions,
  };
}

function identityMapping(length: number): Int32Array {
  const mapping = new Int32Array(length);
  for (let index = 0; index < length; index += 1) {
    mapping[index] = index;
  }
  return mapping;
}

/**
 * Aligns the unchanged prefix and suffix around one contiguous difference.
 * It is exact for a pure insertion or deletion. For a replacement too large
 * for Myers, it deliberately leaves the entire changed middle unmatched.
 */
function makeContiguousChangeAlignment(
  beforeLength: number,
  liveLength: number,
  change: TextSplice,
): TextAlignment {
  const mapping = new Int32Array(beforeLength);
  mapping.fill(-1);

  for (let index = 0; index < change.index; index += 1) {
    mapping[index] = index;
  }

  const beforeSuffixStart = change.index + change.deleteCount;
  const liveSuffixStart = change.index + change.insert.length;
  for (
    let beforeIndex = beforeSuffixStart, liveIndex = liveSuffixStart;
    beforeIndex < beforeLength && liveIndex < liveLength;
    beforeIndex += 1, liveIndex += 1
  ) {
    mapping[beforeIndex] = liveIndex;
  }

  return makeAlignment(mapping, liveLength);
}

function mapBoundaryThroughAlignment(
  alignment: TextAlignment,
  position: number,
  affinity: TextAffinity,
): number {
  return affinity === "before"
    ? alignment.boundaryBeforeInsertions[position]
    : alignment.boundaryAfterInsertions[position];
}

function mapBoundaryConservatively(
  before: string,
  liveText: string,
  position: number,
  affinity: TextAffinity,
): number {
  let prefixLength = 0;
  const sharedLimit = Math.min(before.length, liveText.length);

  while (
    prefixLength < sharedLimit &&
    before.charCodeAt(prefixLength) === liveText.charCodeAt(prefixLength)
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  const suffixLimit = Math.min(
    before.length - prefixLength,
    liveText.length - prefixLength,
  );
  while (
    suffixLength < suffixLimit &&
    before.charCodeAt(before.length - suffixLength - 1) ===
      liveText.charCodeAt(liveText.length - suffixLength - 1)
  ) {
    suffixLength += 1;
  }

  if (position < prefixLength) {
    return position;
  }

  if (position > before.length - suffixLength) {
    return liveText.length - (before.length - position);
  }

  return affinity === "before"
    ? prefixLength
    : liveText.length - suffixLength;
}

function frontierValue(
  frontier: Int32Array,
  depth: number,
  diagonal: number,
): number {
  if (
    diagonal < -depth ||
    diagonal > depth ||
    (diagonal + depth) % 2 !== 0
  ) {
    return Number.NEGATIVE_INFINITY;
  }

  return frontier[diagonal + depth];
}

function readLimit(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const limit = value ?? fallback;
  assertOffset(limit, name);
  return limit;
}

function isNoop(splice: TextSplice): boolean {
  return splice.deleteCount === 0 && splice.insert.length === 0;
}

function assertSelection(selection: TextSelection, textLength?: number): void {
  assertOffset(selection.start, "selection.start");
  assertOffset(selection.end, "selection.end");

  if (selection.end < selection.start) {
    throw new RangeError("selection.end must be greater than or equal to start");
  }

  if (textLength !== undefined && selection.end > textLength) {
    throw new RangeError("selection extends past the end of the text");
  }
}

function assertSplice(splice: TextSplice, textLength?: number): void {
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

function assertOffset(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

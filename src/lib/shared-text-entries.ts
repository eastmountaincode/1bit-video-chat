import type { TextSelection, TextSplice } from "./collaborative-text.ts";

const ENTRY_SEPARATOR = "\u0000";

export type EntrySplice = {
  deleteCount: number;
  index: number;
  insert: string[];
};

export type SharedTextMerge = {
  accepted: boolean;
  entries: string[];
  operations: EntrySplice[];
  selection: TextSelection;
  text: string;
};

export function createTextEntries(text: string, prefix: string) {
  return text.split("").map(
    (character, index) =>
      `${prefix === "b" ? index.toString(36) : `${prefix}.${index.toString(36)}`}${ENTRY_SEPARATOR}${character}`,
  );
}

export function readTextEntries(entries: string[]) {
  return entries.map(readEntryCharacter).join("");
}

export function readTextEntriesSafely(
  entries: unknown[],
  maxLength = Number.POSITIVE_INFINITY,
) {
  const length = Math.min(entries.length, maxLength);
  const ids = new Set<string>();
  let text = "";

  for (let index = 0; index < length; index += 1) {
    const entry = entries[index];
    if (typeof entry !== "string") return null;

    const separatorIndex = entry.indexOf(ENTRY_SEPARATOR);
    if (separatorIndex <= 0) return null;

    const id = entry.slice(0, separatorIndex);
    const character = entry.slice(separatorIndex + 1);
    if (ids.has(id) || character.length !== 1) return null;

    ids.add(id);
    text += character;
  }

  return text;
}

/**
 * Applies edits written against a stale visible snapshot to the latest shared
 * entry array. Stable IDs target the exact characters the user saw, so equal
 * spaces/braces are never guessed by string alignment.
 */
export function mergeTextEntrySplices(
  baseEntries: string[],
  liveEntries: string[],
  localSplices: TextSplice[],
  selection: TextSelection,
  createPrefix: () => string,
  maxLength: number,
): SharedTextMerge {
  if (readTextEntries(baseEntries).length !== baseEntries.length) {
    throw new Error("Each shared text entry must contain one UTF-16 code unit");
  }

  if (canBatchIndependentInsertions(localSplices)) {
    return mergeIndependentInsertions(
      baseEntries,
      liveEntries,
      localSplices,
      selection,
      createPrefix,
      maxLength,
    );
  }

  if (canBatchIndependentDeletions(localSplices)) {
    return mergeIndependentDeletions(
      baseEntries,
      liveEntries,
      localSplices,
      selection,
    );
  }

  const intended = [...baseEntries];
  const live = [...liveEntries];
  const operations: EntrySplice[] = [];

  for (const splice of localSplices) {
    validateSplice(splice, intended.length);
    const deletedIds = new Set(
      intended
        .slice(splice.index, splice.index + splice.deleteCount)
        .map(readEntryId),
    );
    const deletionIndexes = live
      .map((entry, index) => (deletedIds.has(readEntryId(entry)) ? index : -1))
      .filter((index) => index >= 0);

    for (const run of consecutiveRuns(deletionIndexes).reverse()) {
      const operation = {
        index: run.index,
        deleteCount: run.length,
        insert: [],
      };
      live.splice(operation.index, operation.deleteCount);
      operations.push(operation);
    }

    const availableLength = Math.max(0, maxLength - live.length);
    const insertedText = splice.insert.slice(0, availableLength);
    const insertedEntries = createTextEntries(insertedText, createPrefix());
    const insertionIndex = findInsertionIndex(
      intended,
      live,
      splice.index,
      splice.deleteCount,
    );

    if (insertedEntries.length > 0) {
      const operation = {
        index: insertionIndex,
        deleteCount: 0,
        insert: insertedEntries,
      };
      live.splice(insertionIndex, 0, ...insertedEntries);
      operations.push(operation);
    }

    intended.splice(
      splice.index,
      splice.deleteCount,
      ...insertedEntries,
    );
  }

  return {
    accepted: true,
    entries: live,
    operations,
    selection: mapSelectionByIdentity(intended, live, selection),
    text: readTextEntries(live),
  };
}

function canBatchIndependentInsertions(splices: TextSplice[]) {
  return (
    splices.length > 1 &&
    splices.every(
      (splice, index) =>
        splice.deleteCount === 0 &&
        (index === 0 || splice.index < splices[index - 1].index),
    )
  );
}

function canBatchIndependentDeletions(splices: TextSplice[]) {
  return (
    splices.length > 1 &&
    splices.every(
      (splice, index) =>
        splice.deleteCount > 0 &&
        splice.insert === "" &&
        (index === 0 ||
          splice.index + splice.deleteCount <= splices[index - 1].index),
    )
  );
}

function mergeIndependentInsertions(
  baseEntries: string[],
  liveEntries: string[],
  localSplices: TextSplice[],
  selection: TextSelection,
  createPrefix: () => string,
  maxLength: number,
): SharedTextMerge {
  let availableLength = Math.max(0, maxLength - liveEntries.length);
  const groupsDescending = localSplices.map((splice) => {
    validateSplice(splice, baseEntries.length);
    const insertedText = splice.insert.slice(0, availableLength);
    const entries = createTextEntries(insertedText, createPrefix());
    availableLength -= entries.length;
    return { entries, index: splice.index };
  });
  const groupsAscending = [...groupsDescending].reverse();
  const groupsByIndex = new Map(
    groupsAscending.map((group) => [group.index, group.entries]),
  );
  const intended: string[] = [];

  for (let index = 0; index <= baseEntries.length; index += 1) {
    intended.push(...(groupsByIndex.get(index) ?? []));
    if (index < baseEntries.length) intended.push(baseEntries[index]);
  }

  const liveIds = new Set(liveEntries.map(readEntryId));
  const nextAnchorIds = new Array<string | null>(
    baseEntries.length + 1,
  ).fill(null);
  for (let index = baseEntries.length - 1; index >= 0; index -= 1) {
    const id = readEntryId(baseEntries[index]);
    nextAnchorIds[index] = liveIds.has(id)
      ? id
      : nextAnchorIds[index + 1];
  }

  const insertionsByAnchor = new Map<string | null, string[]>();
  for (const group of groupsAscending) {
    if (group.entries.length === 0) continue;
    const anchorId = nextAnchorIds[group.index];
    const existing = insertionsByAnchor.get(anchorId) ?? [];
    existing.push(...group.entries);
    insertionsByAnchor.set(anchorId, existing);
  }

  const live = [...liveEntries];
  const merged: string[] = [];
  const operations: EntrySplice[] = [];
  let outputIndex = 0;

  for (const entry of live) {
    const anchorId = readEntryId(entry);
    const insertion = insertionsByAnchor.get(anchorId);
    if (insertion) {
      operations.push({
        index: outputIndex,
        deleteCount: 0,
        insert: insertion,
      });
      merged.push(...insertion);
      outputIndex += insertion.length;
      insertionsByAnchor.delete(anchorId);
    }

    merged.push(entry);
    outputIndex += 1;
  }

  const trailingInsertion = insertionsByAnchor.get(null);
  if (trailingInsertion) {
    operations.push({
      index: outputIndex,
      deleteCount: 0,
      insert: trailingInsertion,
    });
    merged.push(...trailingInsertion);
  }

  return {
    accepted: true,
    entries: merged,
    operations,
    selection: mapSelectionByIdentity(intended, merged, selection),
    text: readTextEntries(merged),
  };
}

function mergeIndependentDeletions(
  baseEntries: string[],
  liveEntries: string[],
  localSplices: TextSplice[],
  selection: TextSelection,
): SharedTextMerge {
  const deletedIds = new Set<string>();
  for (const splice of localSplices) {
    validateSplice(splice, baseEntries.length);
    for (
      let index = splice.index;
      index < splice.index + splice.deleteCount;
      index += 1
    ) {
      deletedIds.add(readEntryId(baseEntries[index]));
    }
  }

  const deletionIndexes: number[] = [];
  const merged: string[] = [];
  for (let index = 0; index < liveEntries.length; index += 1) {
    const entry = liveEntries[index];
    if (deletedIds.has(readEntryId(entry))) {
      deletionIndexes.push(index);
    } else {
      merged.push(entry);
    }
  }

  const operations = consecutiveRuns(deletionIndexes)
    .reverse()
    .map((run) => ({
      index: run.index,
      deleteCount: run.length,
      insert: [],
    }));
  const intended = baseEntries.filter(
    (entry) => !deletedIds.has(readEntryId(entry)),
  );

  return {
    accepted: true,
    entries: merged,
    operations,
    selection: mapSelectionByIdentity(intended, merged, selection),
    text: readTextEntries(merged),
  };
}

export function mapSelectionByIdentity(
  before: string[],
  after: string[],
  selection: TextSelection,
): TextSelection {
  const start = mapBoundary(before, after, selection.start, "right");
  const end =
    selection.start === selection.end
      ? start
      : mapBoundary(before, after, selection.end, "left");

  return { ...selection, start, end: Math.max(start, end) };
}

function findInsertionIndex(
  before: string[],
  live: string[],
  index: number,
  deleteCount: number,
) {
  const liveIds = new Map(
    live.map((entry, liveIndex) => [readEntryId(entry), liveIndex]),
  );

  for (
    let beforeIndex = index + deleteCount;
    beforeIndex < before.length;
    beforeIndex += 1
  ) {
    const liveIndex = liveIds.get(readEntryId(before[beforeIndex]));
    if (liveIndex !== undefined) return liveIndex;
  }

  return live.length;
}

function mapBoundary(
  before: string[],
  after: string[],
  position: number,
  affinity: "left" | "right",
) {
  const clamped = Math.min(Math.max(0, position), before.length);
  const afterIds = new Map(
    after.map((entry, index) => [readEntryId(entry), index]),
  );

  if (affinity === "right") {
    for (let index = clamped; index < before.length; index += 1) {
      const mapped = afterIds.get(readEntryId(before[index]));
      if (mapped !== undefined) return mapped;
    }
    for (let index = clamped - 1; index >= 0; index -= 1) {
      const mapped = afterIds.get(readEntryId(before[index]));
      if (mapped !== undefined) return mapped + 1;
    }
    return Math.min(clamped, after.length);
  }

  for (let index = clamped - 1; index >= 0; index -= 1) {
    const mapped = afterIds.get(readEntryId(before[index]));
    if (mapped !== undefined) return mapped + 1;
  }
  for (let index = clamped; index < before.length; index += 1) {
    const mapped = afterIds.get(readEntryId(before[index]));
    if (mapped !== undefined) return mapped;
  }
  return Math.min(clamped, after.length);
}

function consecutiveRuns(indexes: number[]) {
  const runs: Array<{ index: number; length: number }> = [];
  for (const index of indexes) {
    const previous = runs[runs.length - 1];
    if (previous && previous.index + previous.length === index) {
      previous.length += 1;
    } else {
      runs.push({ index, length: 1 });
    }
  }
  return runs;
}

function readEntryId(entry: string) {
  const separatorIndex = entry.indexOf(ENTRY_SEPARATOR);
  if (separatorIndex <= 0) throw new Error("Invalid shared text entry");
  return entry.slice(0, separatorIndex);
}

function readEntryCharacter(entry: string) {
  const separatorIndex = entry.indexOf(ENTRY_SEPARATOR);
  if (separatorIndex <= 0) throw new Error("Invalid shared text entry");
  return entry.slice(separatorIndex + 1);
}

function validateSplice(splice: TextSplice, length: number) {
  if (
    !Number.isSafeInteger(splice.index) ||
    !Number.isSafeInteger(splice.deleteCount) ||
    splice.index < 0 ||
    splice.deleteCount < 0 ||
    splice.index + splice.deleteCount > length
  ) {
    throw new RangeError("splice is outside the visible text");
  }
}

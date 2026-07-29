import {
  createTextEntries,
  readTextEntriesSafely,
} from "./shared-text-entries.ts";

export interface CollaborativeCodeData {
  current: CollaborativeCodeDocument | null;
  updatedAt: number;
  updatedBy: string;
  version: 1;
}

export interface CollaborativeCodeDocument {
  createdAt: number;
  entries: string[];
  id: string;
}

export const DEFAULT_COLLABORATIVE_CODE_DATA: CollaborativeCodeData = {
  current: null,
  updatedAt: 0,
  updatedBy: "",
  version: 1,
};

export function createCollaborativeCodeDocument(
  code: string,
  id: string,
  createdAt: number,
  maxLength: number,
): CollaborativeCodeDocument {
  return {
    createdAt,
    entries: createTextEntries(code.slice(0, maxLength), "b"),
    id,
  };
}

export function getCollaborativeCode(
  data: CollaborativeCodeData,
  fallback: string,
  maxLength: number,
) {
  if (!Array.isArray(data.current?.entries)) {
    return fallback.slice(0, maxLength);
  }

  return (
    readTextEntriesSafely(data.current.entries, maxLength) ??
    fallback.slice(0, maxLength)
  );
}

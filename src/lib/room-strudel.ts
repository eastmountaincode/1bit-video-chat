import {
  createCollaborativeCodeDocument,
  getCollaborativeCode,
  type CollaborativeCodeData,
  type CollaborativeCodeDocument,
} from "./collaborative-code.ts";

export const MAX_STRUDEL_CODE_LENGTH = 10_000;

export const DEFAULT_STRUDEL_CODE =
  'note("<c3 eb3 g3 bb3>").s("sine").slow(2)';

export type CollaborativeRoomStrudelData = CollaborativeCodeData;

export type RoomStrudelDocument = CollaborativeCodeDocument;

export const DEFAULT_COLLABORATIVE_ROOM_STRUDEL: CollaborativeRoomStrudelData =
  {
    current: null,
    updatedAt: 0,
    updatedBy: "",
    version: 1,
  };

export interface StrudelFrameCommand {
  canRun: boolean;
  code: string;
  disabled: boolean;
  revision: string;
  source: "telepathy-strudel";
  type: "stage";
}

export type StrudelFrameEvent =
  | {
      source: "telepathy-strudel";
      type: "ready";
    }
  | {
      error?: string;
      ok: boolean;
      revision: string;
      source: "telepathy-strudel";
      type: "result";
    }
  | {
      source: "telepathy-strudel";
      type: "stopped";
    };

export type StrudelRuntimeStatus =
  | {
      state: "running";
    }
  | {
      state: "stopped";
    }
  | {
      error: string;
      state: "error";
    };

export function createRoomStrudelDocument(
  code: string,
  id: string,
  createdAt: number,
): RoomStrudelDocument {
  return createCollaborativeCodeDocument(
    code,
    id,
    createdAt,
    MAX_STRUDEL_CODE_LENGTH,
  );
}

export function getCollaborativeRoomStrudelCode(
  strudel: CollaborativeRoomStrudelData,
  fallback: string,
) {
  return getCollaborativeCode(
    strudel,
    fallback,
    MAX_STRUDEL_CODE_LENGTH,
  );
}

export function createStrudelRevision(code: string) {
  return `${code.length}:${hashStrudelCode(code)}`;
}

export function isStrudelFrameCommand(
  value: unknown,
): value is StrudelFrameCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Partial<StrudelFrameCommand>;

  return (
    command.source === "telepathy-strudel" &&
    command.type === "stage" &&
    typeof command.code === "string" &&
    command.code.length <= MAX_STRUDEL_CODE_LENGTH &&
    typeof command.revision === "string" &&
    typeof command.canRun === "boolean" &&
    typeof command.disabled === "boolean"
  );
}

export function isStrudelFrameEvent(
  value: unknown,
): value is StrudelFrameEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<StrudelFrameEvent>;

  if (event.source !== "telepathy-strudel") return false;
  if (event.type === "ready" || event.type === "stopped") return true;
  if (event.type !== "result") return false;

  return (
    typeof event.ok === "boolean" &&
    typeof event.revision === "string" &&
    (event.error === undefined || typeof event.error === "string")
  );
}

function hashStrudelCode(code: string) {
  let hash = 2_166_136_261;

  for (let index = 0; index < code.length; index += 1) {
    hash ^= code.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0).toString(36);
}

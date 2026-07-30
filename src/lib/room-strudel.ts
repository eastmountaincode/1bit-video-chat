import {
  createCollaborativeCodeDocument,
  getCollaborativeCode,
  type CollaborativeCodeData,
  type CollaborativeCodeDocument,
} from "./collaborative-code.ts";

export const MAX_STRUDEL_CODE_LENGTH = 10_000;
export const MAX_STRUDEL_RUNTIME_COMMAND_ID_LENGTH = 128;
export const MAX_STRUDEL_RUNTIME_REQUESTED_BY_LENGTH = 24;

export const DEFAULT_STRUDEL_CODE =
  'note("<c3 eb3 g3 bb3>").s("sine").slow(2)';

export interface RoomStrudelRuntimeSnapshot {
  commandId: string;
  enabled: boolean;
  code: string;
  requestedAt: number;
  requestedBy: string;
}

export interface RoomStrudelRuntimeData {
  current: RoomStrudelRuntimeSnapshot | null;
  version: 1;
}

export const DEFAULT_ROOM_STRUDEL_RUNTIME: RoomStrudelRuntimeData = {
  current: null,
  version: 1,
};

export type CollaborativeRoomStrudelData = CollaborativeCodeData;

export type RoomStrudelDocument = CollaborativeCodeDocument;

export const DEFAULT_COLLABORATIVE_ROOM_STRUDEL: CollaborativeRoomStrudelData =
  {
    current: null,
    updatedAt: 0,
    updatedBy: "",
    version: 1,
  };

export function createRoomStrudelRuntimeSnapshot({
  commandId,
  enabled,
  code,
  requestedAt,
  requestedBy,
}: RoomStrudelRuntimeSnapshot): RoomStrudelRuntimeSnapshot {
  return {
    commandId: commandId.slice(0, MAX_STRUDEL_RUNTIME_COMMAND_ID_LENGTH),
    enabled,
    code: code.slice(0, MAX_STRUDEL_CODE_LENGTH),
    requestedAt:
      Number.isFinite(requestedAt) && requestedAt >= 0 ? requestedAt : 0,
    requestedBy: requestedBy.slice(
      0,
      MAX_STRUDEL_RUNTIME_REQUESTED_BY_LENGTH,
    ),
  };
}

export function normalizeRoomStrudelRuntimeData(
  value: unknown,
): RoomStrudelRuntimeData {
  if (!isRecord(value) || value.version !== 1) {
    return DEFAULT_ROOM_STRUDEL_RUNTIME;
  }

  const current = value.current;
  if (current === null) return DEFAULT_ROOM_STRUDEL_RUNTIME;
  if (
    !isRecord(current) ||
    typeof current.commandId !== "string" ||
    current.commandId.trim().length === 0 ||
    typeof current.enabled !== "boolean" ||
    typeof current.code !== "string" ||
    typeof current.requestedAt !== "number" ||
    !Number.isFinite(current.requestedAt) ||
    current.requestedAt < 0 ||
    typeof current.requestedBy !== "string"
  ) {
    return DEFAULT_ROOM_STRUDEL_RUNTIME;
  }

  const snapshot = createRoomStrudelRuntimeSnapshot({
    commandId: current.commandId,
    enabled: current.enabled,
    code: current.code,
    requestedAt: current.requestedAt,
    requestedBy: current.requestedBy,
  });
  if (
    snapshot.commandId.trim().length === 0 ||
    (snapshot.enabled && snapshot.code.trim().length === 0)
  ) {
    return DEFAULT_ROOM_STRUDEL_RUNTIME;
  }

  return {
    current: snapshot,
    version: 1,
  };
}

interface StrudelStageFrameCommand {
  canRun: boolean;
  code: string;
  disabled: boolean;
  revision: string;
  source: "telepathy-strudel";
  type: "stage";
}

interface StrudelUpdateFrameCommand {
  code: string;
  commandId: string;
  revision: string;
  source: "telepathy-strudel";
  type: "update";
}

export type StrudelFrameCommand =
  | StrudelStageFrameCommand
  | StrudelUpdateFrameCommand
  | {
      commandId: string;
      source: "telepathy-strudel";
      type: "stop";
    };

export type StrudelFrameEvent =
  | {
      source: "telepathy-strudel";
      type: "ready";
    }
  | {
      source: "telepathy-strudel";
      type: "reset-request";
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
    }
  | {
      code: string;
      commandId: string;
      revision: string;
      source: "telepathy-strudel";
      type: "run-request";
    }
  | {
      commandId: string;
      source: "telepathy-strudel";
      type: "stop-request";
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

  if (command.source !== "telepathy-strudel") return false;
  if (command.type === "stop") {
    return isRuntimeCommandId(command.commandId);
  }
  if (command.type === "update") {
    return (
      typeof command.code === "string" &&
      command.code.length <= MAX_STRUDEL_CODE_LENGTH &&
      typeof command.revision === "string" &&
      isRuntimeCommandId(command.commandId)
    );
  }
  if (command.type !== "stage") return false;

  return (
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
  if (
    event.type === "ready" ||
    event.type === "reset-request" ||
    event.type === "stopped"
  ) {
    return true;
  }
  if (event.type === "stop-request") {
    return isRuntimeCommandId(event.commandId);
  }
  if (event.type === "run-request") {
    return (
      typeof event.code === "string" &&
      event.code.length <= MAX_STRUDEL_CODE_LENGTH &&
      typeof event.revision === "string" &&
      isRuntimeCommandId(event.commandId)
    );
  }
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

function isRuntimeCommandId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= MAX_STRUDEL_RUNTIME_COMMAND_ID_LENGTH
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

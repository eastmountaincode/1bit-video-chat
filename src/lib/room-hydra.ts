import {
  createCollaborativeCodeDocument,
  getCollaborativeCode,
  type CollaborativeCodeData,
  type CollaborativeCodeDocument,
} from "./collaborative-code.ts";

export const MAX_HYDRA_CODE_LENGTH = 10_000;

export const DEFAULT_HYDRA_CODE = `osc(8, 0.05, 0)
  .kaleid(4)
  .posterize(2)
  .saturate(0)
  .contrast(1.4)
  .out()`;

export interface RoomHydraData {
  code: string;
  enabled: boolean;
  updatedAt: number;
  updatedBy: string;
  version: 1;
}

export const DEFAULT_ROOM_HYDRA: RoomHydraData = {
  code: DEFAULT_HYDRA_CODE,
  enabled: false,
  updatedAt: 0,
  updatedBy: "",
  version: 1,
};

/**
 * The shared draft is separate from RoomHydraData.code, which remains the
 * last sketch the room explicitly ran.
 */
export type CollaborativeRoomHydraData = CollaborativeCodeData;

export type RoomHydraDocument = CollaborativeCodeDocument;

export const DEFAULT_COLLABORATIVE_ROOM_HYDRA: CollaborativeRoomHydraData = {
  current: null,
  updatedAt: 0,
  updatedBy: "",
  version: 1,
};

export interface HydraFrameCommand {
  code: string;
  revision: string;
  source: "telepathy-hydra";
  type: "run";
}

export type HydraFrameEvent =
  | {
      source: "telepathy-hydra";
      type: "ready";
    }
  | {
      error?: string;
      ok: boolean;
      revision: string;
      source: "telepathy-hydra";
      type: "result";
    };

export type HydraRuntimeStatus =
  | {
      state: "loading";
    }
  | {
      state: "running";
    }
  | {
      error: string;
      state: "error";
    };

export function normalizeRoomHydraData(
  value: RoomHydraData,
): RoomHydraData {
  const code =
    typeof value.code === "string" && value.code.trim().length > 0
      ? value.code.slice(0, MAX_HYDRA_CODE_LENGTH)
      : DEFAULT_HYDRA_CODE;

  return {
    code,
    enabled: value.enabled === true,
    updatedAt:
      typeof value.updatedAt === "number" &&
      Number.isFinite(value.updatedAt) &&
      value.updatedAt >= 0
        ? value.updatedAt
        : 0,
    updatedBy:
      typeof value.updatedBy === "string" ? value.updatedBy : "",
    version: 1,
  };
}

export function createRoomHydraDocument(
  code: string,
  id: string,
  createdAt: number,
): RoomHydraDocument {
  return createCollaborativeCodeDocument(
    code,
    id,
    createdAt,
    MAX_HYDRA_CODE_LENGTH,
  );
}

export function getCollaborativeRoomHydraCode(
  hydra: CollaborativeRoomHydraData,
  fallback: string,
) {
  return getCollaborativeCode(
    hydra,
    fallback,
    MAX_HYDRA_CODE_LENGTH,
  );
}

export function createHydraRevision(
  code: string,
  updatedAt: number,
) {
  return `${updatedAt}:${code.length}:${hashHydraCode(code)}`;
}

export function isHydraFrameCommand(
  value: unknown,
): value is HydraFrameCommand {
  if (!value || typeof value !== "object") return false;
  const command = value as Partial<HydraFrameCommand>;

  return (
    command.source === "telepathy-hydra" &&
    command.type === "run" &&
    typeof command.code === "string" &&
    command.code.length <= MAX_HYDRA_CODE_LENGTH &&
    typeof command.revision === "string"
  );
}

export function isHydraFrameEvent(
  value: unknown,
): value is HydraFrameEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<HydraFrameEvent>;

  if (event.source !== "telepathy-hydra") return false;
  if (event.type === "ready") return true;
  if (event.type !== "result") return false;

  return (
    typeof event.ok === "boolean" &&
    typeof event.revision === "string" &&
    (event.error === undefined || typeof event.error === "string")
  );
}

function hashHydraCode(code: string) {
  let hash = 2_166_136_261;

  for (let index = 0; index < code.length; index += 1) {
    hash ^= code.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0).toString(36);
}

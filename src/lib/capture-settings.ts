import {
  createVideoPresencePublishBatch,
  getVideoPresenceBatchMessageCount,
  VIDEO_PRESENCE_MAX_HZ,
} from "./video-presence-protocol.ts";

export interface CaptureSettings {
  frameRate: number;
  grayscaleBits: number;
  height: number;
  width: number;
}

export interface CaptureRoomLoad {
  estimatedInboundBytesPerSecond: number;
  participantCount: number;
  pixelUpdatesPerSecond: number;
  roomMessageDeliveriesPerSecond: number;
  transportMessagesPerSecond: number;
  totalPixelNodes: number;
}

export interface AdaptiveCaptureOptions {
  livePixelMetadata?: boolean;
  name?: string;
  serverMaxHz?: number;
}

export const CAPTURE_SETTINGS_LIMITS = {
  frameRate: { min: 1, max: 20 },
  grayscaleBits: { min: 1, max: 5 },
  height: { min: 6, max: 162 },
  width: { min: 8, max: 216 },
} as const;

/**
 * Room-level safety rails. Twenty 100 x 75 tiles exactly meet the node budget.
 * Live pixel metadata has a lower budget because it mutates every cell on every
 * frame; ordinary canvas frames do not pay that DOM cost.
 */
export const CAPTURE_ROOM_BUDGETS = {
  estimatedInboundBytesPerSecond: 1_750_000,
  livePixelUpdatesPerSecond: 40_000,
  pixelOverlayNodes: 4_000,
  pixelUpdatesPerSecond: 2_500_000,
  roomMessageDeliveriesPerSecond: 3_800,
  totalPixelNodes: 150_000,
} as const;

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  frameRate: 15,
  grayscaleBits: 3,
  height: 75,
  width: 100,
};

/**
 * Estimate the receiving work for one participant. Transport envelope bytes
 * are intentionally included so this does not undercount small/chunked frames.
 */
export function estimateCaptureRoomLoad(
  settings: CaptureSettings,
  participantCount: number,
): CaptureRoomLoad {
  const normalized = normalizeCaptureSettings(settings);
  const safeParticipantCount = normalizeParticipantCount(participantCount);
  const remoteParticipantCount = Math.max(0, safeParticipantCount - 1);
  const pixelsPerFrame = normalized.width * normalized.height;
  const transport = estimatePresenceFrameTransport(normalized);

  return {
    estimatedInboundBytesPerSecond:
      remoteParticipantCount * transport.bytes * normalized.frameRate,
    participantCount: safeParticipantCount,
    pixelUpdatesPerSecond:
      safeParticipantCount * pixelsPerFrame * normalized.frameRate,
    roomMessageDeliveriesPerSecond:
      safeParticipantCount *
      remoteParticipantCount *
      transport.messages *
      normalized.frameRate,
    transportMessagesPerSecond:
      transport.messages * normalized.frameRate,
    totalPixelNodes: safeParticipantCount * pixelsPerFrame,
  };
}

/**
 * Clamp only what is needed to keep a room inside its rendering, receiving,
 * and shared PlayHTML event-message budgets.
 */
export function getAdaptiveCaptureSettings(
  requested: CaptureSettings,
  participantCount: number,
  options: AdaptiveCaptureOptions = {},
): CaptureSettings {
  const safeParticipantCount = normalizeParticipantCount(participantCount);
  let settings = normalizeCaptureSettings(requested);
  const aspectRatio = settings.width / settings.height;
  const totalPixelNodeBudget = options.livePixelMetadata
    ? Math.min(
        CAPTURE_ROOM_BUDGETS.totalPixelNodes,
        CAPTURE_ROOM_BUDGETS.pixelOverlayNodes,
      )
    : CAPTURE_ROOM_BUDGETS.totalPixelNodes;
  const pixelBudget = Math.floor(
    totalPixelNodeBudget / safeParticipantCount,
  );

  if (settings.width * settings.height > pixelBudget) {
    settings = scaleDimensionsToPixelBudget(
      settings,
      pixelBudget,
      aspectRatio,
    );
  }

  const remoteParticipantCount = Math.max(0, safeParticipantCount - 1);
  const pixelsPerFrame = settings.width * settings.height;
  const pixelUpdateBudget = options.livePixelMetadata
    ? CAPTURE_ROOM_BUDGETS.livePixelUpdatesPerSecond
    : CAPTURE_ROOM_BUDGETS.pixelUpdatesPerSecond;
  const updateRateLimit = Math.floor(
    pixelUpdateBudget / (safeParticipantCount * pixelsPerFrame),
  );
  const transport = estimatePresenceFrameTransport(settings, options.name);
  const serverMaxHz = normalizeServerMaxHz(options.serverMaxHz);
  const transportRateLimit = Math.floor(
    serverMaxHz / transport.messages,
  );
  const fanoutRateLimit =
    remoteParticipantCount === 0
      ? CAPTURE_SETTINGS_LIMITS.frameRate.max
      : Math.floor(
          CAPTURE_ROOM_BUDGETS.roomMessageDeliveriesPerSecond /
            (safeParticipantCount *
              remoteParticipantCount *
              transport.messages),
        );
  const inboundRateLimit =
    remoteParticipantCount === 0
      ? CAPTURE_SETTINGS_LIMITS.frameRate.max
      : Math.floor(
          CAPTURE_ROOM_BUDGETS.estimatedInboundBytesPerSecond /
            (remoteParticipantCount * transport.bytes),
        );

  return {
    ...settings,
    frameRate: clampInteger(
      Math.min(
        settings.frameRate,
        updateRateLimit,
        inboundRateLimit,
        transportRateLimit,
        fanoutRateLimit,
      ),
      CAPTURE_SETTINGS_LIMITS.frameRate.min,
      CAPTURE_SETTINGS_LIMITS.frameRate.max,
    ),
  };
}

export function getPixelOverlayCellBudget(participantCount: number) {
  return Math.max(
    1,
    Math.floor(
      CAPTURE_ROOM_BUDGETS.pixelOverlayNodes /
        normalizeParticipantCount(participantCount),
    ),
  );
}

export function normalizeCaptureSettings(
  settings: CaptureSettings,
): CaptureSettings {
  return {
    frameRate: clampInteger(
      settings.frameRate,
      CAPTURE_SETTINGS_LIMITS.frameRate.min,
      CAPTURE_SETTINGS_LIMITS.frameRate.max,
    ),
    grayscaleBits: clampInteger(
      settings.grayscaleBits,
      CAPTURE_SETTINGS_LIMITS.grayscaleBits.min,
      CAPTURE_SETTINGS_LIMITS.grayscaleBits.max,
    ),
    height: clampInteger(
      settings.height,
      CAPTURE_SETTINGS_LIMITS.height.min,
      CAPTURE_SETTINGS_LIMITS.height.max,
    ),
    width: clampInteger(
      settings.width,
      CAPTURE_SETTINGS_LIMITS.width.min,
      CAPTURE_SETTINGS_LIMITS.width.max,
    ),
  };
}

function estimatePresenceFrameTransport(
  settings: CaptureSettings,
  participantName = "participant",
) {
  const pixelCount = settings.width * settings.height;
  const packedBytes = Math.ceil(
    (pixelCount * settings.grayscaleBits) / 8,
  );
  const base64Bytes = 4 * Math.ceil(packedBytes / 3);
  const batch = createVideoPresencePublishBatch({
    frame: {
      bits: settings.grayscaleBits,
      data: "A".repeat(base64Bytes),
      height: settings.height,
      width: settings.width,
    },
    name: normalizeEstimatedParticipantName(participantName),
    payloadRate: {
      bytesPerSecond: Number.MAX_VALUE,
      measuredAt: Number.MAX_SAFE_INTEGER,
      windowMs: 5_000,
    },
    publishedAt: Number.MAX_SAFE_INTEGER,
    sequence: Number.MAX_SAFE_INTEGER,
  });
  const messages = getVideoPresenceBatchMessageCount(batch);
  const bytes = batch.messages.reduce(
    (total, message) => total + JSON.stringify(message).length + 128,
    0,
  );

  return { bytes, messages };
}

function normalizeEstimatedParticipantName(value: string) {
  if (typeof value !== "string") return "participant";
  const normalized = value.trim().slice(0, 24);
  return normalized || "participant";
}

function scaleDimensionsToPixelBudget(
  settings: CaptureSettings,
  pixelBudget: number,
  aspectRatio: number,
) {
  const safeAspectRatio =
    Number.isFinite(aspectRatio) && aspectRatio > 0
      ? aspectRatio
      : 4 / 3;
  const maxWidth = Math.floor(Math.sqrt(pixelBudget * safeAspectRatio));
  let width = Math.min(settings.width, Math.floor(maxWidth / 4) * 4);

  width = Math.max(CAPTURE_SETTINGS_LIMITS.width.min, width);
  let height = Math.max(
    CAPTURE_SETTINGS_LIMITS.height.min,
    Math.round(width / safeAspectRatio),
  );

  while (
    width > CAPTURE_SETTINGS_LIMITS.width.min &&
    width * height > pixelBudget
  ) {
    width -= 4;
    height = Math.max(
      CAPTURE_SETTINGS_LIMITS.height.min,
      Math.round(width / safeAspectRatio),
    );
  }

  return { ...settings, height, width };
}

function normalizeParticipantCount(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.ceil(value)) : 1;
}

function normalizeServerMaxHz(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) {
    return VIDEO_PRESENCE_MAX_HZ;
  }
  return Math.max(1, Math.min(VIDEO_PRESENCE_MAX_HZ, Math.floor(value)));
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

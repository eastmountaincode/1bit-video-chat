import type {
  GrayscaleFrame,
  VideoPayloadRate,
} from "./shared-types";

export const VIDEO_PRESENCE_PARTY = "presence";
export const VIDEO_PRESENCE_CHANNEL = "video";
export const VIDEO_PRESENCE_CHUNK_CHANNEL_PREFIX = "video:chunk:";
export const VIDEO_PRESENCE_MAX_HZ = 20;
export const VIDEO_PRESENCE_MAX_VALUE_BYTES = 4_096;
export const VIDEO_PRESENCE_CHUNK_DATA_BYTES = 3_900;
export const VIDEO_PRESENCE_MAX_CHUNKS = 8;
export const VIDEO_PRESENCE_MAX_BUFFERED_BYTES = 64 * 1_024;

const VIDEO_FRAME_VERSION = 1;
const MAX_FRAME_WIDTH = 216;
const MAX_FRAME_HEIGHT = 162;
const MAX_NAME_LENGTH = 24;
const MAX_IDENTITY_LENGTH = 512;
const BACKPRESSURE_RETRY_MS = 25;
const RATE_LIMIT_WINDOW_MS = 1_000;
const SOCKET_OPEN = 1;
const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const FRAME_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const textEncoder = new TextEncoder();

export interface VideoFrameMetadata {
  bits: number;
  chunkCount: number;
  data?: string;
  dataLength: number;
  frameId: string;
  height: number;
  publishedAt: number;
  sequence: number;
  type: "video-frame";
  version: 1;
  width: number;
}

export interface VideoFrameChunk {
  data: string;
  frameId: string;
  index: number;
  type: "video-chunk";
  version: 1;
}

export interface VideoPresenceUpdateMessage {
  channel: string;
  type: "presence-update";
  value: VideoFrameChunk | VideoFrameMetadata;
}

export interface VideoPresenceClearMessage {
  channel: string;
  type: "presence-clear";
}

export interface VideoPresencePublishBatch {
  chunkCount: number;
  frameId: string;
  messages: readonly VideoPresenceUpdateMessage[];
}

export interface CreateVideoPresencePublishBatchOptions {
  frame: GrayscaleFrame;
  /** @deprecated Names are published once in the presence identity. */
  name?: string;
  /** @deprecated Payload rates are measured locally, not sent with frames. */
  payloadRate?: VideoPayloadRate | null;
  publishedAt?: number;
  sequence: number;
}

export interface VideoPresenceParticipant {
  connectionId: string;
  frame: GrayscaleFrame;
  frameId: string;
  id: string;
  name: string;
  /** Receiver-local measurement; never transported in frame metadata. */
  payloadRate?: VideoPayloadRate;
  publishedAt: number;
  sequence: number;
}

export type VideoPresencePeerState = Map<string, Map<string, unknown>>;

export type VideoPresenceServerMessage =
  | {
      peers: Record<string, Record<string, unknown>>;
      type: "presence-sync";
    }
  | {
      removes: Record<string, string[]>;
      type: "presence-changes";
      updates: Record<string, Record<string, unknown>>;
    }
  | {
      channel: string;
      hz: number;
      type: "presence-rate";
    }
  | {
      message: string;
      type: "presence-error";
    };

export interface VideoPresenceSocketLike {
  readonly bufferedAmount: number;
  readonly readyState: number;
  send(data: string): unknown;
}

export interface VideoPresenceFlushResult {
  retryAfterMs: number | null;
  sent: boolean;
}

export interface LatestVideoPresencePublisherOptions {
  maxBufferedBytes?: number;
  maxHz?: number;
}

/** Includes the clearing of chunk channels left behind by a larger frame. */
export function getVideoPresenceBatchMessageCount(
  batch: VideoPresencePublishBatch,
  previousChunkCount = 0,
) {
  const safePreviousChunkCount =
    Number.isInteger(previousChunkCount) && previousChunkCount > 0
      ? Math.min(previousChunkCount, VIDEO_PRESENCE_MAX_CHUNKS)
      : 0;
  return (
    batch.messages.length +
    Math.max(0, safePreviousChunkCount - batch.chunkCount)
  );
}

/**
 * Keep a frame in the single `video` value whenever the complete metadata and
 * payload fit PlayHTML's 4 KiB value limit. Larger frames use chunk channels;
 * their chunks are sent first and the `video` update is the commit marker.
 */
export function createVideoPresencePublishBatch({
  frame,
  publishedAt = Date.now(),
  sequence,
}: CreateVideoPresencePublishBatchOptions): VideoPresencePublishBatch {
  const normalizedFrame = validateAndNormalizeFrame(frame);

  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new RangeError("Invalid video frame sequence");
  }
  if (!Number.isSafeInteger(publishedAt) || publishedAt <= 0) {
    throw new RangeError("Invalid video frame publication time");
  }

  const frameId = sequence.toString(36);
  const metadataBase: Omit<
    VideoFrameMetadata,
    "chunkCount" | "data"
  > = {
    bits: normalizedFrame.bits,
    dataLength: normalizedFrame.data.length,
    frameId,
    height: normalizedFrame.height,
    publishedAt,
    sequence,
    type: "video-frame",
    version: VIDEO_FRAME_VERSION,
    width: normalizedFrame.width,
  };
  const inlineMetadata: VideoFrameMetadata = {
    ...metadataBase,
    chunkCount: 0,
    data: normalizedFrame.data,
  };

  if (isPresenceValueSafe(inlineMetadata)) {
    return {
      chunkCount: 0,
      frameId,
      messages: [
        {
          channel: VIDEO_PRESENCE_CHANNEL,
          type: "presence-update",
          value: inlineMetadata,
        },
      ],
    };
  }

  const chunks = splitFrameData(normalizedFrame.data);
  const metadata: VideoFrameMetadata = {
    ...metadataBase,
    chunkCount: chunks.length,
  };
  const messages: VideoPresenceUpdateMessage[] = chunks.map(
    (data, index) => {
      const value: VideoFrameChunk = {
        data,
        frameId,
        index,
        type: "video-chunk",
        version: VIDEO_FRAME_VERSION,
      };

      assertPresenceValueSafe(value);
      return {
        channel: getVideoPresenceChunkChannel(index),
        type: "presence-update",
        value,
      };
    },
  );

  assertPresenceValueSafe(metadata);
  messages.push({
    channel: VIDEO_PRESENCE_CHANNEL,
    type: "presence-update",
    value: metadata,
  });

  return { chunkCount: chunks.length, frameId, messages };
}

export function getVideoPresenceChunkChannel(index: number) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= VIDEO_PRESENCE_MAX_CHUNKS
  ) {
    throw new RangeError("Invalid video presence chunk index");
  }
  return `${VIDEO_PRESENCE_CHUNK_CHANNEL_PREFIX}${index}`;
}

export function getPresenceValueByteLength(value: unknown) {
  let serialized: string | undefined;

  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError("Presence value must be JSON-serializable");
  }

  if (serialized === undefined) {
    throw new TypeError("Presence value must be JSON-serializable");
  }
  return textEncoder.encode(serialized).byteLength;
}

export function assertPresenceValueSafe(value: unknown) {
  if (getPresenceValueByteLength(value) > VIDEO_PRESENCE_MAX_VALUE_BYTES) {
    throw new RangeError(
      `Presence value must be ${VIDEO_PRESENCE_MAX_VALUE_BYTES} bytes or less`,
    );
  }
}

export function parseVideoFrameMetadata(
  value: unknown,
): VideoFrameMetadata | null {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, [
      "bits",
      "chunkCount",
      "data",
      "dataLength",
      "frameId",
      "height",
      // Accepted only so frames from clients on the previous payload shape
      // remain visible during a rolling deployment. They are not returned.
      "name",
      "payloadRate",
      "publishedAt",
      "sequence",
      "type",
      "version",
      "width",
    ]) ||
    !isPresenceValueSafe(value) ||
    value.type !== "video-frame" ||
    value.version !== VIDEO_FRAME_VERSION ||
    !isFrameId(value.frameId) ||
    !isFrameDimension(value.width, MAX_FRAME_WIDTH) ||
    !isFrameDimension(value.height, MAX_FRAME_HEIGHT) ||
    !isGrayscaleBits(value.bits) ||
    !isChunkCount(value.chunkCount) ||
    !isPositiveSafeInteger(value.dataLength) ||
    !isNonNegativeSafeInteger(value.sequence) ||
    !isPositiveSafeInteger(value.publishedAt)
  ) {
    return null;
  }

  if ("name" in value && !isValidName(value.name)) return null;
  if ("payloadRate" in value && !parsePayloadRate(value.payloadRate)) {
    return null;
  }

  const expectedDataLength = getExpectedBase64Length(
    value.width,
    value.height,
    value.bits,
  );
  if (value.dataLength !== expectedDataLength) {
    return null;
  }

  if (value.chunkCount === 0) {
    if (
      typeof value.data !== "string" ||
      value.data.length !== expectedDataLength ||
      !BASE64_PATTERN.test(value.data)
    ) {
      return null;
    }
  } else {
    const expectedChunkCount = Math.ceil(
      expectedDataLength / VIDEO_PRESENCE_CHUNK_DATA_BYTES,
    );
    if (
      "data" in value ||
      value.chunkCount !== expectedChunkCount
    ) {
      return null;
    }
  }

  return {
    bits: value.bits,
    chunkCount: value.chunkCount,
    ...(value.chunkCount === 0 ? { data: value.data as string } : {}),
    dataLength: value.dataLength,
    frameId: value.frameId,
    height: value.height,
    publishedAt: value.publishedAt,
    sequence: value.sequence,
    type: "video-frame",
    version: VIDEO_FRAME_VERSION,
    width: value.width,
  };
}

export function parseVideoFrameChunk(
  value: unknown,
): VideoFrameChunk | null {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, ["data", "frameId", "index", "type", "version"]) ||
    !isPresenceValueSafe(value) ||
    value.type !== "video-chunk" ||
    value.version !== VIDEO_FRAME_VERSION ||
    !isFrameId(value.frameId) ||
    !isChunkIndex(value.index) ||
    typeof value.data !== "string" ||
    value.data.length < 1 ||
    value.data.length > VIDEO_PRESENCE_CHUNK_DATA_BYTES ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)
  ) {
    return null;
  }

  return {
    data: value.data,
    frameId: value.frameId,
    index: value.index,
    type: "video-chunk",
    version: VIDEO_FRAME_VERSION,
  };
}

export function parseVideoPresenceServerMessage(
  data: unknown,
): VideoPresenceServerMessage | null {
  if (typeof data !== "string") return null;

  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }

  if (!isPlainRecord(value) || typeof value.type !== "string") return null;

  switch (value.type) {
    case "presence-sync":
      return isPresenceSnapshot(value.peers)
        ? { peers: value.peers, type: "presence-sync" }
        : null;
    case "presence-changes":
      return isPresenceSnapshot(value.updates) &&
        isPresenceRemovals(value.removes)
        ? {
            removes: value.removes,
            type: "presence-changes",
            updates: value.updates,
          }
        : null;
    case "presence-rate":
      return typeof value.channel === "string" &&
        Number.isFinite(value.hz) &&
        (value.hz as number) > 0
        ? {
            channel: value.channel,
            hz: value.hz as number,
            type: "presence-rate",
          }
        : null;
    case "presence-error":
      return typeof value.message === "string" && value.message.length <= 1_024
        ? { message: value.message, type: "presence-error" }
        : null;
    default:
      return null;
  }
}

/** Mutates the supplied peer map, retaining only video-relevant channels. */
export function applyVideoPresenceServerMessage(
  peers: VideoPresencePeerState,
  message: VideoPresenceServerMessage,
) {
  if (message.type === "presence-sync") {
    peers.clear();
    for (const [connectionId, values] of Object.entries(message.peers)) {
      const tracked = getTrackedChannelValues(values);
      if (tracked.size > 0) peers.set(connectionId, tracked);
    }
    return true;
  }

  if (message.type !== "presence-changes") return false;

  let changed = false;
  for (const [connectionId, values] of Object.entries(message.updates)) {
    const tracked = getTrackedChannelValues(values);
    if (tracked.size === 0) continue;
    const existing = peers.get(connectionId) ?? new Map<string, unknown>();
    peers.set(connectionId, existing);
    for (const [channel, value] of tracked) existing.set(channel, value);
    changed = true;
  }

  for (const [connectionId, channels] of Object.entries(message.removes)) {
    const existing = peers.get(connectionId);
    if (!existing) continue;
    for (const channel of channels) {
      if (!isTrackedVideoChannel(channel)) continue;
      changed = existing.delete(channel) || changed;
    }
    if (existing.size === 0) peers.delete(connectionId);
  }

  return changed;
}

/**
 * Assemble only complete, validated frames and collapse multiple connections
 * belonging to the same PlayHTML public identity into one participant.
 */
export function assembleVideoPresenceParticipants(
  peers: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
  ownIdentity?: string | null,
) {
  const byIdentity = new Map<string, VideoPresenceParticipant>();

  for (const [connectionId, values] of peers) {
    const identity = parseIdentity(values.get("identity"));
    if (!identity || identity.publicKey === ownIdentity) continue;

    const metadata = parseVideoFrameMetadata(
      values.get(VIDEO_PRESENCE_CHANNEL),
    );
    if (!metadata) continue;

    let frameData = metadata.data ?? "";

    if (metadata.chunkCount > 0) {
      const parts: string[] = [];
      let assembledLength = 0;
      let complete = true;

      for (let index = 0; index < metadata.chunkCount; index += 1) {
        const chunk = parseVideoFrameChunk(
          values.get(getVideoPresenceChunkChannel(index)),
        );
        if (
          !chunk ||
          chunk.frameId !== metadata.frameId ||
          chunk.index !== index
        ) {
          complete = false;
          break;
        }
        parts.push(chunk.data);
        assembledLength += chunk.data.length;
        if (assembledLength > metadata.dataLength) {
          complete = false;
          break;
        }
      }

      if (!complete || assembledLength !== metadata.dataLength) continue;
      frameData = parts.join("");
    }

    let frame: ReturnType<typeof validateAndNormalizeFrame>;
    try {
      frame = validateAndNormalizeFrame({
        bits: metadata.bits,
        data: frameData,
        height: metadata.height,
        width: metadata.width,
      });
    } catch {
      continue;
    }
    const participant: VideoPresenceParticipant = {
      connectionId,
      frame,
      frameId: metadata.frameId,
      id: identity.publicKey,
      name: identity.name,
      publishedAt: metadata.publishedAt,
      sequence: metadata.sequence,
    };
    const existing = byIdentity.get(identity.publicKey);

    if (!existing || isNewerParticipant(participant, existing)) {
      byIdentity.set(identity.publicKey, participant);
    }
  }

  return [...byIdentity.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

/**
 * Retains only the newest unsent frame. PartySocket should also be constructed
 * with `maxEnqueuedMessages: 0`, so reconnects cannot replay an old frame train.
 */
export class LatestVideoPresencePublisher {
  readonly #getSocket: () => VideoPresenceSocketLike | null;
  readonly #maxBufferedBytes: number;
  #latestBatch: VideoPresencePublishBatch | null = null;
  #maxHz: number;
  #pending = false;
  #publishedChunkCount = 0;
  #sentMessageTimes: number[] = [];

  constructor(
    getSocket: () => VideoPresenceSocketLike | null,
    options: LatestVideoPresencePublisherOptions = {},
  ) {
    this.#getSocket = getSocket;
    this.#maxBufferedBytes = Math.max(
      VIDEO_PRESENCE_MAX_BUFFERED_BYTES,
      Math.round(options.maxBufferedBytes ?? VIDEO_PRESENCE_MAX_BUFFERED_BYTES),
    );
    this.#maxHz = normalizeMaxHz(options.maxHz);
  }

  get hasPendingFrame() {
    return this.#pending;
  }

  setMaxHz(maxHz: number) {
    this.#maxHz = normalizeMaxHz(maxHz);
  }

  submit(
    batch: VideoPresencePublishBatch,
    now = Date.now(),
  ): VideoPresenceFlushResult {
    this.#latestBatch = batch;
    this.#pending = true;
    return this.flush(now);
  }

  replay(now = Date.now()): VideoPresenceFlushResult {
    this.#pending = this.#latestBatch !== null;
    this.#sentMessageTimes = [];
    this.#publishedChunkCount = 0;
    return this.flush(now);
  }

  flush(now = Date.now()): VideoPresenceFlushResult {
    const batch = this.#latestBatch;
    if (!this.#pending || !batch) return { retryAfterMs: null, sent: false };

    const socket = this.#getSocket();
    if (!socket || socket.readyState !== SOCKET_OPEN) {
      return { retryAfterMs: null, sent: false };
    }

    const serialized = batch.messages.map((message) =>
      JSON.stringify(message),
    );
    for (
      let index = batch.chunkCount;
      index < this.#publishedChunkCount;
      index += 1
    ) {
      const clear: VideoPresenceClearMessage = {
        channel: getVideoPresenceChunkChannel(index),
        type: "presence-clear",
      };
      serialized.push(JSON.stringify(clear));
    }

    const safeNow = Number.isFinite(now) ? now : Date.now();
    this.#pruneSentMessageTimes(safeNow);
    const messageCapacity = Math.max(1, Math.floor(this.#maxHz));

    if (serialized.length > messageCapacity) {
      return { retryAfterMs: RATE_LIMIT_WINDOW_MS, sent: false };
    }

    const messagesOverCapacity =
      this.#sentMessageTimes.length + serialized.length - messageCapacity;
    if (messagesOverCapacity > 0) {
      const releasesAt =
        this.#sentMessageTimes[messagesOverCapacity - 1] +
        RATE_LIMIT_WINDOW_MS;
      return {
        retryAfterMs: Math.max(1, Math.ceil(releasesAt - safeNow)),
        sent: false,
      };
    }

    const queuedBytes = serialized.reduce(
      (total, message) => total + textEncoder.encode(message).byteLength,
      0,
    );
    const bufferedAmount = Number.isFinite(socket.bufferedAmount)
      ? Math.max(0, socket.bufferedAmount)
      : 0;

    if (bufferedAmount + queuedBytes > this.#maxBufferedBytes) {
      return { retryAfterMs: BACKPRESSURE_RETRY_MS, sent: false };
    }

    let sentMessageCount = 0;
    try {
      for (const message of serialized) {
        if (socket.send(message) === false) {
          this.#recordSentMessages(safeNow, sentMessageCount);
          return { retryAfterMs: BACKPRESSURE_RETRY_MS, sent: false };
        }
        sentMessageCount += 1;
      }
    } catch {
      this.#recordSentMessages(safeNow, sentMessageCount);
      return { retryAfterMs: BACKPRESSURE_RETRY_MS, sent: false };
    }

    this.#pending = false;
    this.#recordSentMessages(safeNow, sentMessageCount);
    this.#publishedChunkCount = batch.chunkCount;
    return { retryAfterMs: null, sent: true };
  }

  #recordSentMessages(at: number, count: number) {
    if (count <= 0) return;
    for (let index = 0; index < count; index += 1) {
      this.#sentMessageTimes.push(at);
    }
  }

  #pruneSentMessageTimes(now: number) {
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    const firstActiveIndex = this.#sentMessageTimes.findIndex(
      (sentAt) => sentAt > cutoff,
    );

    if (firstActiveIndex === -1) {
      this.#sentMessageTimes = [];
    } else if (firstActiveIndex > 0) {
      this.#sentMessageTimes.splice(0, firstActiveIndex);
    }
  }
}

function splitFrameData(data: string) {
  const chunks: string[] = [];
  for (
    let offset = 0;
    offset < data.length;
    offset += VIDEO_PRESENCE_CHUNK_DATA_BYTES
  ) {
    chunks.push(data.slice(offset, offset + VIDEO_PRESENCE_CHUNK_DATA_BYTES));
  }
  if (chunks.length < 1 || chunks.length > VIDEO_PRESENCE_MAX_CHUNKS) {
    throw new RangeError("Invalid video frame chunk count");
  }
  return chunks;
}

function validateAndNormalizeFrame(frame: GrayscaleFrame) {
  if (!frame || typeof frame !== "object") {
    throw new TypeError("Invalid grayscale frame");
  }

  const { data, height, width } = frame;
  const bits = frame.bits ?? 4;

  if (
    !isFrameDimension(width, MAX_FRAME_WIDTH) ||
    !isFrameDimension(height, MAX_FRAME_HEIGHT)
  ) {
    throw new RangeError("Invalid grayscale frame dimensions");
  }
  if (!isGrayscaleBits(bits)) {
    throw new RangeError("Invalid grayscale frame bit depth");
  }
  if (
    typeof data !== "string" ||
    data.length !== getExpectedBase64Length(width, height, bits) ||
    !BASE64_PATTERN.test(data)
  ) {
    throw new TypeError("Invalid grayscale frame Base64 data");
  }

  return { bits, data, height, width };
}

function isValidName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_NAME_LENGTH &&
    value === value.trim() &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function parsePayloadRate(value: unknown): VideoPayloadRate | null {
  if (
    !isPlainRecord(value) ||
    !hasOnlyKeys(value, ["bytesPerSecond", "measuredAt", "windowMs"]) ||
    typeof value.bytesPerSecond !== "number" ||
    !Number.isFinite(value.bytesPerSecond) ||
    value.bytesPerSecond < 0 ||
    typeof value.measuredAt !== "number" ||
    !Number.isFinite(value.measuredAt) ||
    value.measuredAt <= 0 ||
    typeof value.windowMs !== "number" ||
    !Number.isFinite(value.windowMs) ||
    value.windowMs < 250 ||
    value.windowMs > 5_000
  ) {
    return null;
  }
  return {
    bytesPerSecond: value.bytesPerSecond,
    measuredAt: value.measuredAt,
    windowMs: value.windowMs,
  };
}

function getExpectedBase64Length(width: number, height: number, bits: number) {
  const expectedBytes = Math.ceil((width * height * bits) / 8);
  return 4 * Math.ceil(expectedBytes / 3);
}

function isFrameDimension(value: unknown, max: number): value is number {
  return Number.isInteger(value) && (value as number) > 0 && (value as number) <= max;
}

function isGrayscaleBits(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 5;
}

function isChunkCount(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= VIDEO_PRESENCE_MAX_CHUNKS
  );
}

function isChunkIndex(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) < VIDEO_PRESENCE_MAX_CHUNKS
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isFrameId(value: unknown): value is string {
  return typeof value === "string" && FRAME_ID_PATTERN.test(value);
}

function isPresenceValueSafe(value: unknown) {
  try {
    return getPresenceValueByteLength(value) <= VIDEO_PRESENCE_MAX_VALUE_BYTES;
  } catch {
    return false;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
) {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isPresenceSnapshot(
  value: unknown,
): value is Record<string, Record<string, unknown>> {
  return (
    isPlainRecord(value) &&
    Object.values(value).every((peer) => isPlainRecord(peer))
  );
}

function isPresenceRemovals(
  value: unknown,
): value is Record<string, string[]> {
  return (
    isPlainRecord(value) &&
    Object.values(value).every(
      (channels) =>
        Array.isArray(channels) &&
        channels.every((channel) => typeof channel === "string"),
    )
  );
}

function getTrackedChannelValues(values: Record<string, unknown>) {
  const tracked = new Map<string, unknown>();
  for (const [channel, value] of Object.entries(values)) {
    if (isTrackedVideoChannel(channel)) tracked.set(channel, value);
  }
  return tracked;
}

function isTrackedVideoChannel(channel: string) {
  if (channel === "identity" || channel === VIDEO_PRESENCE_CHANNEL) return true;
  if (!channel.startsWith(VIDEO_PRESENCE_CHUNK_CHANNEL_PREFIX)) return false;
  const suffix = channel.slice(VIDEO_PRESENCE_CHUNK_CHANNEL_PREFIX.length);
  if (!/^\d+$/.test(suffix)) return false;
  const index = Number(suffix);
  return index >= 0 && index < VIDEO_PRESENCE_MAX_CHUNKS;
}

function parseIdentity(value: unknown) {
  if (!isPlainRecord(value)) return null;
  const publicKey = value.publicKey;
  const name = value.name;
  return typeof publicKey === "string" &&
    publicKey.length > 0 &&
    publicKey.length <= MAX_IDENTITY_LENGTH &&
    !CONTROL_CHARACTER_PATTERN.test(publicKey) &&
    isValidName(name)
    ? { name, publicKey }
    : null;
}

function isNewerParticipant(
  candidate: VideoPresenceParticipant,
  current: VideoPresenceParticipant,
) {
  if (candidate.publishedAt !== current.publishedAt) {
    return candidate.publishedAt > current.publishedAt;
  }
  if (candidate.sequence !== current.sequence) {
    return candidate.sequence > current.sequence;
  }
  return candidate.connectionId > current.connectionId;
}

function normalizeMaxHz(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return VIDEO_PRESENCE_MAX_HZ;
  }
  return Math.max(1, Math.floor(Math.min(VIDEO_PRESENCE_MAX_HZ, value)));
}

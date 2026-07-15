import type {
  VideoPayloadRate,
  VideoPresence,
} from "@/lib/shared-types";

export const VIDEO_PAYLOAD_RATE_WINDOW_MS = 1_000;
const MAX_TRUSTED_CLOCK_DIFFERENCE_MS = 5_000;
const MIN_SHARED_RATE_WINDOW_MS = 250;
const MAX_SHARED_RATE_WINDOW_MS = 5_000;

export interface VideoPayloadSample {
  at: number;
  bytes: number;
}

export interface VideoPayloadWindow {
  bytesPerSecond: number;
  samples: VideoPayloadSample[];
}

const textEncoder = new TextEncoder();

/**
 * Counts the UTF-8 bytes in the video value we give PlayHTML. The rate field
 * itself is omitted so the meter does not measure its own telemetry. PlayHTML
 * does not expose its Yjs, WebSocket, TLS, or TCP overhead.
 */
export function measureVideoPayloadBytes(
  payload: Pick<VideoPresence, "frame" | "name">,
) {
  return textEncoder.encode(JSON.stringify(payload)).byteLength;
}

export function recordVideoPayloadSample(
  samples: readonly VideoPayloadSample[],
  at: number,
  bytes: number,
  windowMs = VIDEO_PAYLOAD_RATE_WINDOW_MS,
): VideoPayloadWindow {
  const safeAt = Number.isFinite(at) ? at : 0;
  const safeBytes = Number.isFinite(bytes)
    ? Math.max(0, Math.round(bytes))
    : 0;
  const safeWindowMs =
    Number.isFinite(windowMs) && windowMs > 0
      ? windowMs
      : VIDEO_PAYLOAD_RATE_WINDOW_MS;
  const cutoff = safeAt - safeWindowMs;
  const recentSamples = samples.filter(
    (sample) => sample.at > cutoff && sample.at <= safeAt,
  );

  recentSamples.push({ at: safeAt, bytes: safeBytes });

  const bytesInWindow = recentSamples.reduce(
    (total, sample) => total + sample.bytes,
    0,
  );

  return {
    bytesPerSecond: Math.round(
      bytesInWindow * (1_000 / safeWindowMs),
    ),
    samples: recentSamples,
  };
}

export function normalizeVideoPayloadRate(
  value: unknown,
): VideoPayloadRate | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<VideoPayloadRate>;
  const { bytesPerSecond, measuredAt, windowMs } = candidate;

  if (
    typeof bytesPerSecond !== "number" ||
    !Number.isFinite(bytesPerSecond) ||
    bytesPerSecond < 0 ||
    typeof measuredAt !== "number" ||
    !Number.isFinite(measuredAt) ||
    measuredAt <= 0 ||
    typeof windowMs !== "number" ||
    !Number.isFinite(windowMs) ||
    windowMs < MIN_SHARED_RATE_WINDOW_MS ||
    windowMs > MAX_SHARED_RATE_WINDOW_MS
  ) {
    return null;
  }

  return { bytesPerSecond, measuredAt, windowMs };
}

export function getVideoPayloadRateLifetime(
  payloadRate: VideoPayloadRate,
  now = Date.now(),
) {
  const age = now - payloadRate.measuredAt;

  if (
    Number.isFinite(now) &&
    age >= 0 &&
    age <= MAX_TRUSTED_CLOCK_DIFFERENCE_MS
  ) {
    return Math.max(0, payloadRate.windowMs - age);
  }

  // If the two device clocks differ substantially, expire from local receipt
  // time instead of falsely declaring a live participant stale.
  return payloadRate.windowMs;
}

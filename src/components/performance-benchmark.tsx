"use client";

import { useEffect, useRef, useState } from "react";

import { VideoTile } from "@/components/video-tile";
import {
  getAdaptiveCaptureSettings,
  getPixelOverlayCellBudget,
} from "@/lib/capture-settings";
import type { GrayscaleFrame } from "@/lib/shared-types";

type BenchmarkPixelStyle =
  | "background"
  | "border"
  | "color"
  | "default"
  | "metadata";
type BenchmarkStatus =
  | "complete"
  | "error"
  | "measuring"
  | "preparing"
  | "warming-up";

interface BenchmarkConfig {
  bits: number;
  durationMs: number;
  fps: number;
  height: number;
  participants: number;
  style: BenchmarkPixelStyle;
  warmupMs: number;
  width: number;
}

interface TimingSummary {
  maxMs: number | null;
  minMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  samples: number;
}

export interface TelepathyBenchmarkResult {
  config: BenchmarkConfig;
  dom: {
    benchmarkElements: number;
    pixelElements: number;
    videoTiles: number;
  };
  environment: {
    devicePixelRatio: number;
    hardwareConcurrency: number | null;
    userAgent: string;
    viewport: {
      height: number;
      width: number;
    };
  };
  generatedAt: string;
  longTasks: {
    count: number;
    longestMs: number | null;
    supported: boolean;
    totalDurationMs: number;
    totalDurationRatio: number;
  };
  memory: {
    endingHeapBytes: number | null;
    heapDeltaBytes: number | null;
    startingHeapBytes: number | null;
  };
  raf: {
    delayOver60HzBudgetMs: TimingSummary;
    intervalMs: TimingSummary;
  };
  status: "complete";
  updates: {
    achievedBatchFps: number;
    coalescedOrUncommittedBatches: number;
    commitLatencyMs: TimingSummary;
    committedBatches: number;
    committedTileUpdates: number;
    committedTileUpdatesPerSecond: number;
    dispatchedBatches: number;
    dispatchedTileUpdates: number;
    expectedBatches: number;
    missedScheduleBatches: number;
    scheduleDelayMs: TimingSummary;
  };
  version: 1;
}

interface RenderState {
  frames: GrayscaleFrame[];
  revision: number;
}

interface ActiveRun {
  commitLatencies: number[];
  committedBatches: number;
  config: BenchmarkConfig;
  dispatchTimes: Map<number, number>;
  dispatchedBatches: number;
  heapAtStart: number | null;
  longTaskDurations: number[];
  measurementEndsAt: number;
  measurementStartedAt: number;
  rafIntervals: number[];
  scheduleDelays: number[];
}

declare global {
  interface Window {
    __telepathyBenchmarkResult?: TelepathyBenchmarkResult | null;
  }
}

const DEFAULT_CONFIG: BenchmarkConfig = {
  bits: 3,
  durationMs: 10_000,
  fps: 15,
  height: 75,
  participants: 20,
  style: "default",
  warmupMs: 2_000,
  width: 100,
};

const SIXTY_HZ_FRAME_BUDGET_MS = 1_000 / 60;

export function PerformanceBenchmark() {
  const [config, setConfig] = useState<BenchmarkConfig>(DEFAULT_CONFIG);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [renderState, setRenderState] = useState<RenderState>({
    frames: [],
    revision: 0,
  });
  const [result, setResult] =
    useState<TelepathyBenchmarkResult | null>(null);
  const [status, setStatus] = useState<BenchmarkStatus>("preparing");
  const activeRunRef = useRef<ActiveRun | null>(null);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const activeRun = activeRunRef.current;
    const dispatchedAt = activeRun?.dispatchTimes.get(renderState.revision);

    if (!activeRun || dispatchedAt === undefined) return;

    activeRun.committedBatches += 1;
    activeRun.commitLatencies.push(performance.now() - dispatchedAt);

    for (const revision of activeRun.dispatchTimes.keys()) {
      if (revision <= renderState.revision) {
        activeRun.dispatchTimes.delete(revision);
      }
    }
  }, [renderState]);

  useEffect(() => {
    window.__telepathyBenchmarkResult = result;
  }, [result]);

  useEffect(() => {
    let animationFrame = 0;
    let cancelled = false;
    let flushLongTasks: (() => void) | null = null;
    let longTaskObserver: PerformanceObserver | null = null;

    try {
      const requestedConfig = readBenchmarkConfig(
        new URLSearchParams(window.location.search),
      );
      const adaptiveSettings = getAdaptiveCaptureSettings(
        {
          frameRate: requestedConfig.fps,
          grayscaleBits: requestedConfig.bits,
          height: requestedConfig.height,
          width: requestedConfig.width,
        },
        requestedConfig.participants,
        {
          livePixelMetadata: requestedConfig.style === "metadata",
          name: `mock ${requestedConfig.participants}`,
        },
      );
      const nextConfig: BenchmarkConfig = {
        ...requestedConfig,
        bits: adaptiveSettings.grayscaleBits,
        fps: adaptiveSettings.frameRate,
        height: adaptiveSettings.height,
        width: adaptiveSettings.width,
      };
      const frameCorpus = createFrameCorpus(
        nextConfig.participants,
        Math.max(8, Math.min(32, nextConfig.fps * 2)),
        nextConfig.width,
        nextConfig.height,
        nextConfig.bits,
      );
      const frameIntervalMs = 1_000 / nextConfig.fps;
      let previousAnimationFrameAt: number | null = null;
      let revision = 0;
      let nextUpdateAt = 0;
      let measurementAnnounced = false;
      let finishing = false;

      const longTasksSupported =
        typeof PerformanceObserver !== "undefined" &&
        PerformanceObserver.supportedEntryTypes.includes("longtask");

      const begin = () => {
        if (cancelled) return;

        const startedAt = performance.now();
        const measurementStartedAt = startedAt + nextConfig.warmupMs;
        const measurementEndsAt =
          measurementStartedAt + nextConfig.durationMs;
        const activeRun: ActiveRun = {
          commitLatencies: [],
          committedBatches: 0,
          config: nextConfig,
          dispatchTimes: new Map(),
          dispatchedBatches: 0,
          heapAtStart: null,
          longTaskDurations: [],
          measurementEndsAt,
          measurementStartedAt,
          rafIntervals: [],
          scheduleDelays: [],
        };

        activeRunRef.current = activeRun;
        nextUpdateAt = startedAt;

        if (longTasksSupported) {
          const recordLongTasks = (entries: PerformanceEntry[]) => {
            for (const entry of entries) {
              if (
                entry.startTime >= activeRun.measurementStartedAt &&
                entry.startTime < activeRun.measurementEndsAt
              ) {
                activeRun.longTaskDurations.push(entry.duration);
              }
            }
          };

          longTaskObserver = new PerformanceObserver((entries) => {
            recordLongTasks(entries.getEntries());
          });
          longTaskObserver.observe({ type: "longtask" });

          flushLongTasks = () => {
            if (!longTaskObserver) return;
            recordLongTasks(longTaskObserver.takeRecords());
          };
        }

        const finish = () => {
          if (cancelled || finishing) return;
          finishing = true;
          flushLongTasks?.();
          longTaskObserver?.disconnect();

          // Let the final React commit and child pixel effects flush before the
          // result counts unresolved updates and DOM nodes.
          animationFrame = window.requestAnimationFrame(() => {
            animationFrame = window.requestAnimationFrame(() => {
              if (cancelled) return;

              const finalResult = buildResult(
                activeRun,
                rootRef.current,
                longTasksSupported,
              );
              activeRunRef.current = null;
              window.__telepathyBenchmarkResult = finalResult;
              setResult(finalResult);
              setStatus("complete");
            });
          });
        };

        const step = (now: number) => {
          if (cancelled) return;

          if (
            previousAnimationFrameAt !== null &&
            now >= activeRun.measurementStartedAt &&
            now <= activeRun.measurementEndsAt
          ) {
            activeRun.rafIntervals.push(now - previousAnimationFrameAt);
          }
          previousAnimationFrameAt = now;

          if (
            !measurementAnnounced &&
            now >= activeRun.measurementStartedAt
          ) {
            measurementAnnounced = true;
            activeRun.heapAtStart = readUsedHeapBytes();
            setStatus("measuring");
          }

          if (now >= activeRun.measurementEndsAt) {
            finish();
            return;
          }

          if (now >= nextUpdateAt) {
            const intervalsBehind = Math.floor(
              (now - nextUpdateAt) / frameIntervalMs,
            );
            const isMeasuring = now >= activeRun.measurementStartedAt;

            revision += 1;
            if (isMeasuring) {
              activeRun.dispatchedBatches += 1;
              activeRun.dispatchTimes.set(revision, now);
              activeRun.scheduleDelays.push(now - nextUpdateAt);
            }

            setRenderState({
              frames: frameCorpus.map(
                (participantFrames, participantIndex) =>
                  participantFrames[
                    (revision + participantIndex) % participantFrames.length
                  ],
              ),
              revision,
            });
            nextUpdateAt += (intervalsBehind + 1) * frameIntervalMs;
          }

          animationFrame = window.requestAnimationFrame(step);
        };

        animationFrame = window.requestAnimationFrame(step);
      };

      // State initialization runs from the browser scheduler rather than
      // synchronously inside the effect. Two more frames allow the initial
      // 150,000-pixel default DOM to mount before the warm-up clock begins.
      animationFrame = window.requestAnimationFrame(() => {
        if (cancelled) return;

        setConfig(nextConfig);
        setRenderState({
          frames: frameCorpus.map((participantFrames) => participantFrames[0]),
          revision,
        });
        setResult(null);
        setStatus("warming-up");
        window.__telepathyBenchmarkResult = null;

        animationFrame = window.requestAnimationFrame(() => {
          animationFrame = window.requestAnimationFrame(begin);
        });
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to start benchmark";
      animationFrame = window.requestAnimationFrame(() => {
        if (cancelled) return;
        setErrorMessage(message);
        setStatus("error");
      });
    }

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      longTaskObserver?.disconnect();
      activeRunRef.current = null;
    };
  }, []);

  const pixelStyle = getPixelStyle(config.style);
  const statusLabel =
    status === "error" ? `error: ${errorMessage}` : status;

  return (
    <main
      className="benchmark-shell"
      data-benchmark-root=""
      ref={rootRef}
    >
      <style>{`
        .benchmark-shell {
          min-height: 100svh;
          padding: 1rem;
        }

        .benchmark-header {
          margin-bottom: 1rem;
        }

        .benchmark-header h1,
        .benchmark-header p {
          margin: 0 0 0.4rem;
        }

        .benchmark-result {
          background: #f4f4f4;
          border: 1px solid #000;
          max-height: 18rem;
          overflow: auto;
          padding: 0.5rem;
          white-space: pre-wrap;
        }

        ${pixelStyle}
      `}</style>

      <header className="benchmark-header">
        <h1>Telepathy rendering benchmark</h1>
        <p>
          {config.participants} participants · {config.fps} fps · {config.style}
          {" "}pixel style · {config.width}×{config.height}×{config.bits}-bit ·
          {" "}{config.durationMs / 1_000}s measurement
        </p>
        <p data-benchmark-status={status}>status: {statusLabel}</p>
        <pre
          className="benchmark-result"
          data-benchmark-result=""
          id="telepathy-benchmark-result"
        >
          {result
            ? JSON.stringify(result, null, 2)
            : "Result will appear here and at window.__telepathyBenchmarkResult."}
        </pre>
      </header>

      <section aria-label="Simulated participant videos">
        <div className="video-grid" data-benchmark-video-grid="">
          {renderState.frames.map((frame, participantIndex) => (
            <div
              data-benchmark-participant={participantIndex + 1}
              key={`benchmark-participant-${participantIndex + 1}`}
            >
              <VideoTile
                frame={frame}
                livePixelMetadata={config.style === "metadata"}
                maxPixelCells={
                  config.style !== "default"
                    ? getPixelOverlayCellBudget(config.participants)
                    : undefined
                }
                name={`mock ${participantIndex + 1}`}
                pixelOverlayEnabled={config.style !== "default"}
                renderWhenOffscreen
              />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function buildResult(
  activeRun: ActiveRun,
  root: HTMLElement | null,
  longTasksSupported: boolean,
): TelepathyBenchmarkResult {
  const { config } = activeRun;
  const durationSeconds = config.durationMs / 1_000;
  const expectedBatches = Math.round(durationSeconds * config.fps);
  const committedTileUpdates =
    activeRun.committedBatches * config.participants;
  const endingHeapBytes = readUsedHeapBytes();
  const longTaskTotal = sum(activeRun.longTaskDurations);
  const rafDelays = activeRun.rafIntervals.map((interval) =>
    Math.max(0, interval - SIXTY_HZ_FRAME_BUDGET_MS),
  );

  return {
    config,
    dom: {
      benchmarkElements: root?.querySelectorAll("*").length ?? 0,
      pixelElements:
        root?.querySelectorAll('[data-room-part="video-pixel"]').length ?? 0,
      videoTiles:
        root?.querySelectorAll('[data-room-part="video-card"]').length ?? 0,
    },
    environment: {
      devicePixelRatio: window.devicePixelRatio,
      hardwareConcurrency: navigator.hardwareConcurrency || null,
      userAgent: navigator.userAgent,
      viewport: {
        height: window.innerHeight,
        width: window.innerWidth,
      },
    },
    generatedAt: new Date().toISOString(),
    longTasks: {
      count: activeRun.longTaskDurations.length,
      longestMs:
        activeRun.longTaskDurations.length > 0
          ? round(Math.max(...activeRun.longTaskDurations))
          : null,
      supported: longTasksSupported,
      totalDurationMs: round(longTaskTotal),
      totalDurationRatio: round(longTaskTotal / config.durationMs),
    },
    memory: {
      endingHeapBytes,
      heapDeltaBytes:
        endingHeapBytes !== null && activeRun.heapAtStart !== null
          ? endingHeapBytes - activeRun.heapAtStart
          : null,
      startingHeapBytes: activeRun.heapAtStart,
    },
    raf: {
      delayOver60HzBudgetMs: summarizeTimings(rafDelays),
      intervalMs: summarizeTimings(activeRun.rafIntervals),
    },
    status: "complete",
    updates: {
      achievedBatchFps: round(activeRun.dispatchedBatches / durationSeconds),
      coalescedOrUncommittedBatches: Math.max(
        0,
        activeRun.dispatchedBatches - activeRun.committedBatches,
      ),
      commitLatencyMs: summarizeTimings(activeRun.commitLatencies),
      committedBatches: activeRun.committedBatches,
      committedTileUpdates,
      committedTileUpdatesPerSecond: round(
        committedTileUpdates / durationSeconds,
      ),
      dispatchedBatches: activeRun.dispatchedBatches,
      dispatchedTileUpdates:
        activeRun.dispatchedBatches * config.participants,
      expectedBatches,
      missedScheduleBatches: Math.max(
        0,
        expectedBatches - activeRun.dispatchedBatches,
      ),
      scheduleDelayMs: summarizeTimings(activeRun.scheduleDelays),
    },
    version: 1,
  };
}

function createFrameCorpus(
  participants: number,
  corpusSize: number,
  width: number,
  height: number,
  bits: number,
) {
  const bytesPerFrame = Math.ceil(
    (width * height * bits) / 8,
  );

  return Array.from({ length: participants }, (_, participantIndex) =>
    Array.from({ length: corpusSize }, (_, frameIndex) => {
      const bytes = new Uint8Array(bytesPerFrame);
      let state =
        ((participantIndex + 1) * 2_654_435_761 +
          (frameIndex + 1) * 1_013_904_223) >>>
        0;

      for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        bytes[byteIndex] = state & 0xff;
      }

      return {
        bits,
        data: bytesToBase64(bytes),
        height,
        width,
      } satisfies GrayscaleFrame;
    }),
  );
}

function bytesToBase64(bytes: Uint8Array) {
  const chunkSize = 8_192;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return window.btoa(binary);
}

function getPixelStyle(style: BenchmarkPixelStyle) {
  if (style === "color") {
    return `
      [data-benchmark-root] [data-room-part="video-frame"] > [data-room-part="video-pixel"] {
        color: red !important;
      }
    `;
  }

  if (style === "background") {
    return `
      [data-benchmark-root] [data-room-part="video-frame"] > [data-room-part="video-pixel"] {
        background: red !important;
      }
    `;
  }

  if (style === "border") {
    return `
      [data-benchmark-root] [data-room-part="video-frame"] > [data-room-part="video-pixel"] {
        border: 1px solid red !important;
      }
    `;
  }

  if (style === "metadata") {
    return `
      [data-benchmark-root] [data-room-part="video-frame"] > [data-room-part="video-pixel"] {
        opacity: calc(var(--pixel-gray, 0) / 255);
      }
    `;
  }

  return "";
}

function readBenchmarkConfig(params: URLSearchParams): BenchmarkConfig {
  const styleValue = params.get("style");
  const style: BenchmarkPixelStyle =
    styleValue === "background" ||
    styleValue === "border" ||
    styleValue === "color" ||
    styleValue === "metadata"
      ? styleValue
      : "default";

  return {
    bits: readBoundedNumber(params, "bits", 3, 1, 5),
    durationMs:
      readBoundedNumber(params, "duration", 10, 1, 30) * 1_000,
    fps: readBoundedNumber(params, "fps", 15, 1, 30),
    height: readBoundedNumber(params, "height", 75, 6, 162),
    participants: readBoundedNumber(params, "participants", 20, 1, 40),
    style,
    warmupMs: readBoundedNumber(params, "warmup", 2, 0, 10) * 1_000,
    width: readBoundedNumber(params, "width", 100, 8, 216),
  };
}

function readBoundedNumber(
  params: URLSearchParams,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const rawValue = params.get(name);
  if (rawValue === null || rawValue.trim() === "") return fallback;

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function readUsedHeapBytes() {
  const memory = (
    performance as Performance & {
      memory?: { usedJSHeapSize?: number };
    }
  ).memory;
  const value = memory?.usedJSHeapSize;

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function summarizeTimings(values: number[]): TimingSummary {
  if (values.length === 0) {
    return {
      maxMs: null,
      minMs: null,
      p50Ms: null,
      p95Ms: null,
      samples: 0,
    };
  }

  const sorted = [...values].sort((left, right) => left - right);

  return {
    maxMs: round(sorted[sorted.length - 1]),
    minMs: round(sorted[0]),
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    samples: sorted.length,
  };
}

function percentile(sortedValues: number[], percentileValue: number) {
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1),
  );
  return sortedValues[index];
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number) {
  return Math.round(value * 1_000) / 1_000;
}

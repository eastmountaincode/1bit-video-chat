"use client";

import { playhtml } from "@playhtml/react";
import PartySocket from "partysocket";
import { useCallback, useEffect, useRef, useState } from "react";

import type { GrayscaleFrame, VideoPayloadRate } from "@/lib/shared-types";
import {
  measureVideoPayloadBytes,
  recordVideoPayloadSample,
  VIDEO_PAYLOAD_RATE_WINDOW_MS,
  type VideoPayloadSample,
} from "@/lib/video-payload-rate";
import {
  applyVideoPresenceServerMessage,
  assembleVideoPresenceParticipants,
  createVideoPresencePublishBatch,
  LatestVideoPresencePublisher,
  parseVideoFrameMetadata,
  parseVideoPresenceServerMessage,
  VIDEO_PRESENCE_CHANNEL,
  VIDEO_PRESENCE_CHUNK_CHANNEL_PREFIX,
  VIDEO_PRESENCE_MAX_HZ,
  VIDEO_PRESENCE_PARTY,
  type VideoPresenceFlushResult,
  type VideoPresenceParticipant,
  type VideoPresencePeerState,
  type VideoPresenceServerMessage,
} from "@/lib/video-presence-protocol";

export type VideoPresenceConnectionState =
  | "disabled"
  | "connecting"
  | "connected"
  | "reconnecting";

export interface UseVideoPresenceOptions {
  enabled?: boolean;
  name: string;
}

export interface UseVideoPresenceResult {
  connectionState: VideoPresenceConnectionState;
  error: string | null;
  participantCount: number;
  participants: VideoPresenceParticipant[];
  publishFrame: (frame: GrayscaleFrame) => boolean;
  serverMaxHz: number;
}

type ParticipantPublishUrgency = "none" | "coalesced" | "immediate";

interface ParticipantRateState {
  frameId: string;
  payloadRate: VideoPayloadRate;
  samples: VideoPayloadSample[];
}

const PARTICIPANT_FRAME_PUBLISH_INTERVAL_MS =
  1_000 / VIDEO_PRESENCE_MAX_HZ;

/**
 * A dedicated, latest-frame-only video path. Unlike usePresence, this talks
 * directly to PlayHTML's `presence` party and does not enter Yjs awareness.
 */
export function useVideoPresence({
  enabled = true,
  name,
}: UseVideoPresenceOptions): UseVideoPresenceResult {
  const [participants, setParticipants] = useState<
    VideoPresenceParticipant[]
  >([]);
  const [connectionState, setConnectionState] =
    useState<VideoPresenceConnectionState>(
      enabled ? "connecting" : "disabled",
    );
  const [error, setError] = useState<string | null>(null);
  const [serverMaxHz, setServerMaxHz] = useState(
    VIDEO_PRESENCE_MAX_HZ,
  );
  const publisherRef = useRef<LatestVideoPresencePublisher | null>(null);
  const scheduleFlushRef = useRef<
    ((result: VideoPresenceFlushResult) => void) | null
  >(null);
  const sequenceRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let flushTimer: number | null = null;
    let participantPublishTimer: number | null = null;
    let participantAnimationFrame = 0;
    let lastParticipantPublishAt = Number.NEGATIVE_INFINITY;
    let lastParticipantSignature = "";
    const participantRates = new Map<string, ParticipantRateState>();
    const peers: VideoPresencePeerState = new Map();
    let identity: ReturnType<typeof getMinimalIdentity>;
    let socket: PartySocket;

    try {
      identity = getMinimalIdentity(name);
      if (!playhtml.host || !playhtml.roomId) {
        throw new Error("PlayHTML room is not ready");
      }
      socket = new PartySocket({
        host: playhtml.host,
        maxEnqueuedMessages: 0,
        party: VIDEO_PRESENCE_PARTY,
        room: playhtml.roomId,
      });
    } catch (setupError) {
      const setupErrorTimer = window.setTimeout(() => {
        setConnectionState("reconnecting");
        setError(
          setupError instanceof Error
            ? setupError.message
            : "Unable to start the video connection.",
        );
      }, 0);
      return () => window.clearTimeout(setupErrorTimer);
    }
    const publisher = new LatestVideoPresencePublisher(() => socket);

    publisherRef.current = publisher;
    setConnectionState("connecting");
    setError(null);
    setServerMaxHz(VIDEO_PRESENCE_MAX_HZ);

    function scheduleFlush(result: VideoPresenceFlushResult) {
      if (
        disposed ||
        result.retryAfterMs === null ||
        flushTimer !== null
      ) {
        return;
      }

      flushTimer = window.setTimeout(() => {
        flushTimer = null;
        scheduleFlush(publisher.flush(performance.now()));
      }, result.retryAfterMs);
    }

    scheduleFlushRef.current = scheduleFlush;

    function publishParticipants() {
      const activeConnectionIds = new Set<string>();
      const nextParticipants = assembleVideoPresenceParticipants(
        peers,
        identity.publicKey,
      ).map((participant) => {
        activeConnectionIds.add(participant.connectionId);
        let current = participantRates.get(participant.connectionId);

        // Presence syncs contain only the latest frame, so seed their local
        // meter here. Normal frame changes are sampled at message receipt.
        if (!current || current.frameId !== participant.frameId) {
          current = recordParticipantRate(
            current,
            participant.frameId,
            measureVideoPayloadBytes(participant.frame),
          );
          participantRates.set(participant.connectionId, current);
        }

        return { ...participant, payloadRate: current.payloadRate };
      });

      for (const connectionId of participantRates.keys()) {
        if (!activeConnectionIds.has(connectionId)) {
          participantRates.delete(connectionId);
        }
      }
      const signature = nextParticipants
        .map(
          (participant) =>
            `${participant.id}:${participant.connectionId}:${participant.frameId}:${participant.publishedAt}`,
        )
        .join("|");

      if (signature === lastParticipantSignature) return;
      lastParticipantSignature = signature;
      setParticipants(nextParticipants);
    }

    function queueParticipantAnimationFrame() {
      if (participantAnimationFrame !== 0 || disposed) return;
      participantAnimationFrame = window.requestAnimationFrame(() => {
        participantAnimationFrame = 0;
        if (disposed) return;
        lastParticipantPublishAt = performance.now();
        publishParticipants();
      });
    }

    function scheduleParticipantPublish(immediate = false) {
      if (disposed) return;

      if (immediate) {
        if (participantPublishTimer !== null) {
          window.clearTimeout(participantPublishTimer);
          participantPublishTimer = null;
        }
        queueParticipantAnimationFrame();
        return;
      }

      if (
        participantPublishTimer !== null ||
        participantAnimationFrame !== 0
      ) {
        return;
      }

      const delay = Math.max(
        0,
        lastParticipantPublishAt +
          PARTICIPANT_FRAME_PUBLISH_INTERVAL_MS -
          performance.now(),
      );

      participantPublishTimer = window.setTimeout(() => {
        participantPublishTimer = null;
        queueParticipantAnimationFrame();
      }, delay);
    }

    function handleOpen() {
      if (disposed) return;
      const joinMessage = {
        identity,
        page: window.location.pathname.slice(0, 512),
        type: "presence-join",
      };

      socket.send(JSON.stringify(joinMessage));
      setConnectionState("connected");
      setError(null);
      scheduleFlush(publisher.replay(performance.now()));
    }

    function handleClose() {
      if (!disposed) setConnectionState("reconnecting");
    }

    function handleError() {
      if (!disposed) {
        setConnectionState("reconnecting");
        setError("The video connection was interrupted; reconnecting.");
      }
    }

    function handleMessage(event: MessageEvent) {
      const message = parseVideoPresenceServerMessage(event.data);
      if (!message || disposed) return;

      if (message.type === "presence-rate") {
        if (
          message.channel === VIDEO_PRESENCE_CHANNEL ||
          message.channel.startsWith(
            VIDEO_PRESENCE_CHUNK_CHANNEL_PREFIX,
          )
        ) {
          const nextMaxHz = Math.min(
            VIDEO_PRESENCE_MAX_HZ,
            message.hz,
          );
          publisher.setMaxHz(nextMaxHz);
          setServerMaxHz(nextMaxHz);
        }
        return;
      }

      if (message.type === "presence-error") {
        setError(`Video presence error: ${message.message}`);
        return;
      }

      const publishUrgency = getParticipantPublishUrgency(message);
      const peersChanged = applyVideoPresenceServerMessage(peers, message);
      if (peersChanged) recordReceivedFrameRates(message);
      if (
        publishUrgency !== "none" &&
        peersChanged
      ) {
        scheduleParticipantPublish(publishUrgency === "immediate");
      }
    }

    function recordReceivedFrameRates(message: VideoPresenceServerMessage) {
      if (message.type !== "presence-changes") return;

      for (const [connectionId, values] of Object.entries(message.updates)) {
        const metadata = parseVideoFrameMetadata(
          values[VIDEO_PRESENCE_CHANNEL],
        );
        if (!metadata) continue;

        const peerIdentity = peers.get(connectionId)?.get("identity");
        const publicKey = getIdentityPublicKey(peerIdentity);
        if (!publicKey || publicKey === identity.publicKey) continue;

        const current = participantRates.get(connectionId);
        if (current?.frameId === metadata.frameId) continue;

        participantRates.set(
          connectionId,
          recordParticipantRate(current, metadata.frameId, metadata.dataLength),
        );
      }
    }

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleError);
    socket.addEventListener("message", handleMessage);

    return () => {
      disposed = true;
      if (flushTimer !== null) window.clearTimeout(flushTimer);
      if (participantPublishTimer !== null) {
        window.clearTimeout(participantPublishTimer);
      }
      window.cancelAnimationFrame(participantAnimationFrame);
      if (publisherRef.current === publisher) publisherRef.current = null;
      if (scheduleFlushRef.current === scheduleFlush) {
        scheduleFlushRef.current = null;
      }
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("error", handleError);
      socket.removeEventListener("message", handleMessage);
      socket.close();
    };
  }, [enabled, name]);

  const publishFrame = useCallback(
    (frame: GrayscaleFrame) => {
      if (!enabled) return false;
      const publisher = publisherRef.current;
      if (!publisher) return false;

      sequenceRef.current =
        sequenceRef.current >= Number.MAX_SAFE_INTEGER
          ? 0
          : sequenceRef.current + 1;

      try {
        const batch = createVideoPresencePublishBatch({
          frame,
          sequence: sequenceRef.current,
        });
        const result = publisher.submit(batch, performance.now());
        scheduleFlushRef.current?.(result);
        return true;
      } catch (publishError) {
        setError(
          publishError instanceof Error
            ? publishError.message
            : "Unable to publish the video frame.",
        );
        return false;
      }
    },
    [enabled],
  );

  return {
    connectionState: enabled ? connectionState : "disabled",
    error,
    participantCount: participants.length + 1,
    participants,
    publishFrame,
    serverMaxHz,
  };
}

function getParticipantPublishUrgency(
  message: VideoPresenceServerMessage,
): ParticipantPublishUrgency {
  if (message.type === "presence-sync") return "immediate";
  if (message.type !== "presence-changes") return "none";

  const hasImmediateChange =
    Object.values(message.updates).some(
      (values) => "identity" in values,
    ) ||
    Object.values(message.removes).some(
      (channels) =>
        channels.includes("identity") ||
        channels.includes(VIDEO_PRESENCE_CHANNEL),
    );

  if (hasImmediateChange) return "immediate";

  return Object.values(message.updates).some(
    (values) => VIDEO_PRESENCE_CHANNEL in values,
  )
    ? "coalesced"
    : "none";
}

function getMinimalIdentity(name: string) {
  const identity = playhtml.presence.getMyIdentity();
  const publicKey = identity.publicKey;
  const primaryColor = identity.playerStyle?.colorPalette?.[0];

  if (
    typeof publicKey !== "string" ||
    publicKey.length === 0 ||
    typeof primaryColor !== "string" ||
    primaryColor.length === 0
  ) {
    throw new Error("PlayHTML identity is not ready");
  }

  return {
    name: name.trim().slice(0, 24),
    playerStyle: { colorPalette: [primaryColor] },
    publicKey,
  };
}

function getIdentityPublicKey(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const publicKey = (value as Record<string, unknown>).publicKey;
  return typeof publicKey === "string" && publicKey.length > 0
    ? publicKey
    : null;
}

function recordParticipantRate(
  current: ParticipantRateState | undefined,
  frameId: string,
  bytes: number,
): ParticipantRateState {
  const payloadWindow = recordVideoPayloadSample(
    current?.samples ?? [],
    performance.now(),
    bytes,
  );

  return {
    frameId,
    payloadRate: {
      bytesPerSecond: payloadWindow.bytesPerSecond,
      measuredAt: Date.now(),
      windowMs: VIDEO_PAYLOAD_RATE_WINDOW_MS,
    },
    samples: payloadWindow.samples,
  };
}

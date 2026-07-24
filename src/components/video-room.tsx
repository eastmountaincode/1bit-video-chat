"use client";

import { usePageData, usePlayContext } from "@playhtml/react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  RoomSidebar,
  type SidebarPanel,
} from "@/components/room-sidebar";
import { VideoTile } from "@/components/video-tile";
import { useGrayscaleCamera } from "@/hooks/use-grayscale-camera";
import { useVideoPresence } from "@/hooks/use-video-presence";
import {
  DEFAULT_CAPTURE_SETTINGS,
  getAdaptiveCaptureSettings,
  getPixelOverlayCellBudget,
  type CaptureSettings,
} from "@/lib/capture-settings";
import {
  DEFAULT_COLLABORATIVE_ROOM_STYLE,
  DEFAULT_ROOM_STYLE,
  roomStyleUsesLivePixelMetadata,
  roomStyleUsesVideoPixelOverlay,
  ROOM_STYLE_SCAFFOLD,
  type CollaborativeRoomStyleData,
  type RoomStyleData,
} from "@/lib/room-style";
import type { VideoPayloadRate } from "@/lib/shared-types";
import {
  measureVideoPayloadBytes,
  recordVideoPayloadSample,
  VIDEO_PAYLOAD_RATE_WINDOW_MS,
  type VideoPayloadSample,
} from "@/lib/video-payload-rate";

interface VideoRoomProps {
  name: string;
  onLeave: () => void;
  roomName: string;
  stream: MediaStream;
}

export function VideoRoom({ name, onLeave, roomName, stream }: VideoRoomProps) {
  const [captureSettings, setCaptureSettings] = useState<CaptureSettings>(
    DEFAULT_CAPTURE_SETTINGS,
  );
  const [activePanel, setActivePanel] = useState<SidebarPanel>("chat");
  const { isLoading } = usePlayContext();
  const {
    connectionState,
    error: videoConnectionError,
    participantCount,
    participants: remoteParticipants,
    publishFrame,
    serverMaxHz,
  } = useVideoPresence({ enabled: !isLoading, name });
  const videoConnectionStatus =
    connectionState === "reconnecting"
      ? "Video connection: reconnecting... Sending and receiving video is paused."
      : videoConnectionError;
  const [legacyStyle] = usePageData<RoomStyleData>(
    "room-style:v1",
    DEFAULT_ROOM_STYLE,
  );
  const [sharedStyle] = usePageData<CollaborativeRoomStyleData>(
    "room-style:v2",
    DEFAULT_COLLABORATIVE_ROOM_STYLE,
  );
  const sharedCss = Array.isArray(sharedStyle.chars)
    ? sharedStyle.chars.join("")
    : typeof legacyStyle.css === "string"
      ? legacyStyle.css
      : ROOM_STYLE_SCAFFOLD;
  const livePixelMetadata = useMemo(
    () => roomStyleUsesLivePixelMetadata(sharedCss),
    [sharedCss],
  );
  const pixelOverlayEnabled = useMemo(
    () => roomStyleUsesVideoPixelOverlay(sharedCss),
    [sharedCss],
  );
  const effectiveCaptureSettings = useMemo(
    () =>
      getAdaptiveCaptureSettings(captureSettings, participantCount, {
        livePixelMetadata,
        name,
        serverMaxHz,
      }),
    [captureSettings, livePixelMetadata, name, participantCount, serverMaxHz],
  );
  const maxPixelCells = pixelOverlayEnabled
    ? getPixelOverlayCellBudget(participantCount)
    : undefined;
  const frame = useGrayscaleCamera(stream, effectiveCaptureSettings);
  const payloadSamplesRef = useRef<VideoPayloadSample[]>([]);
  const lastPayloadRateUiUpdateRef = useRef(0);
  const [localPayloadRate, setLocalPayloadRate] =
    useState<VideoPayloadRate | null>(null);

  useEffect(() => {
    if (!frame || isLoading) return;

    const measuredAt = Date.now();
    const payloadWindow = recordVideoPayloadSample(
      payloadSamplesRef.current,
      performance.now(),
      measureVideoPayloadBytes(frame),
    );
    const payloadRate: VideoPayloadRate = {
      bytesPerSecond: payloadWindow.bytesPerSecond,
      measuredAt,
      windowMs: VIDEO_PAYLOAD_RATE_WINDOW_MS,
    };

    payloadSamplesRef.current = payloadWindow.samples;
    if (measuredAt - lastPayloadRateUiUpdateRef.current >= 500) {
      lastPayloadRateUiUpdateRef.current = measuredAt;
      setLocalPayloadRate(payloadRate);
    }
    publishFrame(frame);
  }, [frame, isLoading, publishFrame]);

  useEffect(() => {
    let isHelperKeyDown = false;
    let helperKeyReleaseTimer: number | null = null;

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const isTyping =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.matches("input, textarea, select, button"));

      if (event.key.toLowerCase() === "h" && helperKeyReleaseTimer !== null) {
        window.clearTimeout(helperKeyReleaseTimer);
        helperKeyReleaseTimer = null;
      }

      if (
        !isTyping &&
        !isHelperKeyDown &&
        event.key.toLowerCase() === "h"
      ) {
        isHelperKeyDown = true;
        setActivePanel((panel) =>
          panel === "settings" ? "chat" : "settings",
        );
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "h") {
        helperKeyReleaseTimer = window.setTimeout(() => {
          isHelperKeyDown = false;
          helperKeyReleaseTimer = null;
        }, 150);
      }
    }

    function handleBlur() {
      isHelperKeyDown = false;
      if (helperKeyReleaseTimer !== null) {
        window.clearTimeout(helperKeyReleaseTimer);
        helperKeyReleaseTimer = null;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    return () => {
      if (helperKeyReleaseTimer !== null) {
        window.clearTimeout(helperKeyReleaseTimer);
      }
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  return (
    <main
      className="room-shell"
      data-room-part="room"
      data-video-connection={connectionState}
    >
      <section className="video-column" data-room-part="video-area">
        <fieldset className="video-fieldset" data-room-part="video-field">
          <legend>video ({participantCount})</legend>
          <button
            className="leave-button"
            data-room-part="leave"
            onClick={onLeave}
            type="button"
          >
            leave room
          </button>
          <div className="video-grid" data-room-part="video-grid">
            <VideoTile
              frame={frame}
              isMe
              livePixelMetadata={livePixelMetadata}
              maxPixelCells={maxPixelCells}
              name={name}
              payloadRate={localPayloadRate}
              pixelOverlayEnabled={pixelOverlayEnabled}
            />
            {remoteParticipants.map((participant) => (
              <VideoTile
                frame={participant.frame}
                key={participant.id}
                livePixelMetadata={livePixelMetadata}
                maxPixelCells={maxPixelCells}
                name={participant.name}
                payloadRate={participant.payloadRate}
                pixelOverlayEnabled={pixelOverlayEnabled}
              />
            ))}
          </div>
        </fieldset>
      </section>
      <RoomSidebar
        activePanel={activePanel}
        captureSettings={captureSettings}
        effectiveCaptureSettings={effectiveCaptureSettings}
        name={name}
        onCaptureSettingsChange={setCaptureSettings}
        onPanelChange={setActivePanel}
        participantCount={participantCount}
        roomName={roomName}
        videoConnectionStatus={videoConnectionStatus}
      />
    </main>
  );
}

"use client";

import { usePageData, usePlayContext } from "@playhtml/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { HydraBackground } from "@/components/hydra-background";
import {
  RoomSidebar,
  type SidebarPanel,
} from "@/components/room-sidebar";
import { VideoTile } from "@/components/video-tile";
import { useGrayscaleCamera } from "@/hooks/use-grayscale-camera";
import { useVideoPresence } from "@/hooks/use-video-presence";
import {
  DEFAULT_CAPTURE_SETTINGS,
  type CaptureSettings,
} from "@/lib/capture-settings";
import {
  DEFAULT_ROOM_HYDRA,
  normalizeRoomHydraData,
  type HydraRuntimeStatus,
  type RoomHydraData,
} from "@/lib/room-hydra";
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
  const [rawRoomHydra, setRoomHydra] = usePageData<RoomHydraData>(
    "room-hydra:v1",
    DEFAULT_ROOM_HYDRA,
  );
  const roomHydra = normalizeRoomHydraData(rawRoomHydra);
  const [hydraRuntimeStatus, setHydraRuntimeStatus] =
    useState<HydraRuntimeStatus | null>(null);
  const {
    connectionState,
    error: videoConnectionError,
    participantCount,
    participants: remoteParticipants,
    publishFrame,
  } = useVideoPresence({ enabled: !isLoading, name });
  const videoConnectionStatus =
    connectionState === "reconnecting"
      ? "video reconnecting..."
      : videoConnectionError;
  const frame = useGrayscaleCamera(stream, captureSettings);
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

  const runHydra = useCallback(
    (code: string) => {
      if (isLoading) return;

      setRoomHydra((draft) => {
        draft.code = code;
        draft.enabled = true;
        draft.updatedAt = Date.now();
        draft.updatedBy = name;
        draft.version = 1;
      });
    },
    [isLoading, name, setRoomHydra],
  );

  const stopHydra = useCallback(() => {
    if (isLoading) return;

    setRoomHydra((draft) => {
      draft.enabled = false;
      draft.updatedAt = Date.now();
      draft.updatedBy = name;
      draft.version = 1;
    });
  }, [isLoading, name, setRoomHydra]);

  return (
    <main
      className="room-shell"
      data-hydra-enabled={roomHydra.enabled ? "true" : "false"}
      data-room-part="room"
      data-video-connection={connectionState}
    >
      {roomHydra.enabled ? (
        <HydraBackground
          code={roomHydra.code}
          onStatusChange={setHydraRuntimeStatus}
          updatedAt={roomHydra.updatedAt}
        />
      ) : null}
      <section className="video-column" data-room-part="video-area">
        <fieldset className="video-fieldset" data-room-part="video-field">
          <legend>video ({participantCount})</legend>
          <div className="video-grid" data-room-part="video-grid">
            <VideoTile
              frame={frame}
              isMe
              name={name}
              payloadRate={localPayloadRate}
            />
            {remoteParticipants.map((participant) => (
              <VideoTile
                frame={participant.frame}
                key={participant.id}
                name={participant.name}
                payloadRate={participant.payloadRate}
              />
            ))}
          </div>
        </fieldset>
      </section>
      <RoomSidebar
        activePanel={activePanel}
        captureSettings={captureSettings}
        hydraDisabled={isLoading}
        hydraRuntimeStatus={
          roomHydra.enabled ? hydraRuntimeStatus : null
        }
        name={name}
        onCaptureSettingsChange={setCaptureSettings}
        onHydraRun={runHydra}
        onHydraStop={stopHydra}
        onLeave={onLeave}
        onPanelChange={setActivePanel}
        roomHydra={roomHydra}
        roomName={roomName}
        strudelDisabled={isLoading}
        videoConnectionStatus={videoConnectionStatus}
      />
    </main>
  );
}

"use client";

import { usePlayContext, usePresence } from "@playhtml/react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  RoomSidebar,
  type SidebarPanel,
} from "@/components/room-sidebar";
import { VideoTile } from "@/components/video-tile";
import { useGrayscaleCamera } from "@/hooks/use-grayscale-camera";
import {
  DEFAULT_CAPTURE_SETTINGS,
  type CaptureSettings,
} from "@/lib/capture-settings";
import type {
  VideoPayloadRate,
  VideoPresence,
} from "@/lib/shared-types";
import {
  measureVideoPayloadBytes,
  recordVideoPayloadSample,
  VIDEO_PAYLOAD_RATE_WINDOW_MS,
  type VideoPayloadSample,
} from "@/lib/video-payload-rate";

interface VideoRoomProps {
  name: string;
  onLeave: () => void;
  stream: MediaStream;
}

interface VideoPresenceView {
  isMe: boolean;
  video?: VideoPresence;
}

export function VideoRoom({ name, onLeave, stream }: VideoRoomProps) {
  const [captureSettings, setCaptureSettings] = useState<CaptureSettings>(
    DEFAULT_CAPTURE_SETTINGS,
  );
  const [activePanel, setActivePanel] = useState<SidebarPanel>("chat");
  const frame = useGrayscaleCamera(stream, captureSettings);
  const { isLoading } = usePlayContext();
  const { presences, setMyPresence } = usePresence<VideoPresence>("video");
  const payloadSamplesRef = useRef<VideoPayloadSample[]>([]);
  const [localPayloadRate, setLocalPayloadRate] =
    useState<VideoPayloadRate | null>(null);
  const setVideoPresence = setMyPresence as (
    value: VideoPresence | null,
  ) => void;

  useEffect(() => {
    if (!frame || isLoading) return;

    const measuredAt = Date.now();
    const payloadWindow = recordVideoPayloadSample(
      payloadSamplesRef.current,
      performance.now(),
      measureVideoPayloadBytes({ frame, name }),
    );
    const payloadRate: VideoPayloadRate = {
      bytesPerSecond: payloadWindow.bytesPerSecond,
      measuredAt,
      windowMs: VIDEO_PAYLOAD_RATE_WINDOW_MS,
    };

    payloadSamplesRef.current = payloadWindow.samples;
    setLocalPayloadRate(payloadRate);
    setVideoPresence({ frame, name, payloadRate });
  }, [frame, isLoading, name, setVideoPresence]);

  useEffect(
    () => () => {
      if (!isLoading) setVideoPresence(null);
    },
    [isLoading, setVideoPresence],
  );

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

  const remoteParticipants = useMemo(
    () =>
      [...presences.entries()].flatMap(([id, rawPresence]) => {
        const presence = rawPresence as unknown as VideoPresenceView;
        if (presence.isMe || !presence.video) return [];
        return [{ id, ...presence.video }];
      }),
    [presences],
  );

  const participantCount = remoteParticipants.length + 1;

  return (
    <main className="room-shell" data-room-part="room">
      <section className="video-column" data-room-part="video-area">
        <fieldset className="video-fieldset" data-room-part="video-field">
          <legend>video ({participantCount})</legend>
          <button
            className="leave-button"
            data-room-part="leave"
            onClick={onLeave}
            type="button"
          >
            leave
          </button>
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
        name={name}
        onCaptureSettingsChange={setCaptureSettings}
        onPanelChange={setActivePanel}
      />
    </main>
  );
}

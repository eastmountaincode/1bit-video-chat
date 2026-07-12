"use client";

import { usePresence } from "@playhtml/react";
import { useEffect, useMemo, useState } from "react";

import { ChatPanel } from "@/components/chat-panel";
import { HelperPanel } from "@/components/helper-panel";
import { VideoTile } from "@/components/video-tile";
import { useGrayscaleCamera } from "@/hooks/use-grayscale-camera";
import {
  DEFAULT_CAPTURE_SETTINGS,
  type CaptureSettings,
} from "@/lib/capture-settings";
import type { VideoPresence } from "@/lib/shared-types";

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
  const [isHelperOpen, setIsHelperOpen] = useState(false);
  const frame = useGrayscaleCamera(stream, captureSettings);
  const { presences, setMyPresence } = usePresence<VideoPresence>("video");
  const setVideoPresence = setMyPresence as (
    value: VideoPresence | null,
  ) => void;

  useEffect(() => {
    if (!frame) return;
    setVideoPresence({ frame, name });
  }, [frame, name, setVideoPresence]);

  useEffect(
    () => () => {
      setVideoPresence(null);
    },
    [setVideoPresence],
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
        setIsHelperOpen((isOpen) => !isOpen);
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
    <main className="room-shell">
      <section className="video-column">
        <p className="mobile-site-title">Sesame Chat</p>
        <fieldset className="video-fieldset">
          <legend>video ({participantCount})</legend>
          <button className="leave-button" onClick={onLeave} type="button">
            leave
          </button>
          <div className="video-grid">
            <VideoTile frame={frame} isMe name={name} />
            {remoteParticipants.map((participant) => (
              <VideoTile
                frame={participant.frame}
                key={participant.id}
                name={participant.name}
              />
            ))}
          </div>
        </fieldset>
      </section>
      <ChatPanel name={name} />
      {isHelperOpen ? (
        <HelperPanel
          onChange={setCaptureSettings}
          settings={captureSettings}
        />
      ) : null}
    </main>
  );
}

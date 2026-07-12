"use client";

import { usePresence } from "@playhtml/react";
import { useEffect, useMemo } from "react";

import { ChatPanel } from "@/components/chat-panel";
import { VideoTile } from "@/components/video-tile";
import { useGrayscaleCamera } from "@/hooks/use-grayscale-camera";
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
  const frame = useGrayscaleCamera(stream);
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
    </main>
  );
}

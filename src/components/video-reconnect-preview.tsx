"use client";

import { VideoRoom } from "@/components/video-room";

interface VideoReconnectPreviewProps {
  roomName: string;
}

export function VideoReconnectPreview({
  roomName,
}: VideoReconnectPreviewProps) {
  function leaveRoom() {
    window.location.assign("/");
  }

  return (
    <VideoRoom
      name="Preview user"
      onLeave={leaveRoom}
      previewMode="video-reconnecting"
      roomName={roomName}
      stream={null}
    />
  );
}

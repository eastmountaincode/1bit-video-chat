"use client";

import { useState } from "react";

import { JoinSplash } from "@/components/join-splash";
import { VideoRoom } from "@/components/video-room";
import { useCamera } from "@/hooks/use-camera";

interface VideoChatAppProps {
  roomName: string;
}

export function VideoChatApp({ roomName }: VideoChatAppProps) {
  const { permission, requestCamera, stream } = useCamera();
  const [name, setName] = useState<string | null>(null);

  function leaveRoom() {
    // Unload every camera and PlayHTML transport before returning to the lobby.
    window.location.assign("/");
  }

  if (name && stream) {
    return (
      <VideoRoom
        name={name}
        onLeave={leaveRoom}
        roomName={roomName}
        stream={stream}
      />
    );
  }

  return (
    <JoinSplash
      onJoin={setName}
      permission={permission}
      requestCamera={requestCamera}
      stream={stream}
    />
  );
}

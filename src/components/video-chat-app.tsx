"use client";

import { useState } from "react";

import { JoinSplash } from "@/components/join-splash";
import { VideoRoom } from "@/components/video-room";
import { useCamera } from "@/hooks/use-camera";

export function VideoChatApp() {
  const { permission, requestCamera, stream } = useCamera();
  const [name, setName] = useState<string | null>(null);

  if (name && stream) {
    return (
      <VideoRoom name={name} onLeave={() => setName(null)} stream={stream} />
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

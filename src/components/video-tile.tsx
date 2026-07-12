"use client";

import { GrayscaleCanvas } from "@/components/grayscale-canvas";
import type { GrayscaleFrame } from "@/lib/shared-types";

interface VideoTileProps {
  frame: GrayscaleFrame | null;
  isMe?: boolean;
  name: string;
}

export function VideoTile({ frame, isMe = false, name }: VideoTileProps) {
  return (
    <figure className="video-tile" data-room-part="video-card">
      <GrayscaleCanvas frame={frame} />
      <figcaption data-room-part="video-caption">
        {name}
        {isMe ? " (you)" : ""}
      </figcaption>
    </figure>
  );
}

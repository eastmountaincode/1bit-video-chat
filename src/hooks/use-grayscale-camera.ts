"use client";

import { useEffect, useState } from "react";

import {
  FRAME_HEIGHT,
  FRAME_INTERVAL_MS,
  FRAME_WIDTH,
  packGrayscaleFrame,
} from "@/lib/grayscale-frame";
import type { GrayscaleFrame } from "@/lib/shared-types";

export function useGrayscaleCamera(stream: MediaStream | null) {
  const [frame, setFrame] = useState<GrayscaleFrame | null>(null);

  useEffect(() => {
    if (!stream) return;

    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
    });

    if (!context) return;

    canvas.width = FRAME_WIDTH;
    canvas.height = FRAME_HEIGHT;
    context.imageSmoothingEnabled = false;
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;

    let animationFrame = 0;
    let lastCaptureAt = 0;
    let lastFrameData = "";
    let cancelled = false;

    const capture = (now: number) => {
      if (cancelled) return;

      if (
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        now - lastCaptureAt >= FRAME_INTERVAL_MS
      ) {
        lastCaptureAt = now;
        context.save();
        context.translate(FRAME_WIDTH, 0);
        context.scale(-1, 1);
        context.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
        context.restore();

        const image = context.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
        const nextFrame = packGrayscaleFrame(image.data);

        if (nextFrame.data !== lastFrameData) {
          lastFrameData = nextFrame.data;
          setFrame(nextFrame);
        }
      }

      animationFrame = window.requestAnimationFrame(capture);
    };

    void video
      .play()
      .then(() => {
        if (!cancelled) {
          animationFrame = window.requestAnimationFrame(capture);
        }
      })
      .catch((error: unknown) => {
        const isExpectedAbort =
          error instanceof DOMException && error.name === "AbortError";
        if (!cancelled && !isExpectedAbort) {
          console.error("Unable to start camera preview", error);
        }
      });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      video.pause();
      video.srcObject = null;
    };
  }, [stream]);

  return stream ? frame : null;
}

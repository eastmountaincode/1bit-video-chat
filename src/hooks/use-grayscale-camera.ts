"use client";

import { useEffect, useState } from "react";

import type { CaptureSettings } from "@/lib/capture-settings";
import { DEFAULT_CAPTURE_SETTINGS } from "@/lib/capture-settings";
import { packGrayscaleFrame } from "@/lib/grayscale-frame";
import type { GrayscaleFrame } from "@/lib/shared-types";

export function useGrayscaleCamera(
  stream: MediaStream | null,
  settings: CaptureSettings = DEFAULT_CAPTURE_SETTINGS,
) {
  const [frame, setFrame] = useState<GrayscaleFrame | null>(null);
  const { frameRate, grayscaleBits, height, width } = settings;

  useEffect(() => {
    if (!stream) return;

    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", {
      alpha: false,
      willReadFrequently: true,
    });

    if (!context) return;

    canvas.width = width;
    canvas.height = height;
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
        now - lastCaptureAt >= 1000 / frameRate
      ) {
        lastCaptureAt = now;
        const sourceWidth = video.videoWidth;
        const sourceHeight = video.videoHeight;
        const sourceAspect = sourceWidth / sourceHeight;
        const targetAspect = width / height;
        let cropX = 0;
        let cropY = 0;
        let cropWidth = sourceWidth;
        let cropHeight = sourceHeight;

        if (sourceAspect > targetAspect) {
          cropWidth = sourceHeight * targetAspect;
          cropX = (sourceWidth - cropWidth) / 2;
        } else if (sourceAspect < targetAspect) {
          cropHeight = sourceWidth / targetAspect;
          cropY = (sourceHeight - cropHeight) / 2;
        }

        context.save();
        context.translate(width, 0);
        context.scale(-1, 1);
        context.drawImage(
          video,
          cropX,
          cropY,
          cropWidth,
          cropHeight,
          0,
          0,
          width,
          height,
        );
        context.restore();

        const image = context.getImageData(0, 0, width, height);
        const nextFrame = packGrayscaleFrame(
          image.data,
          width,
          height,
          grayscaleBits,
        );

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
  }, [frameRate, grayscaleBits, height, stream, width]);

  return stream ? frame : null;
}

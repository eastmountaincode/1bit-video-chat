"use client";

import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { unpackGrayscaleFrame } from "@/lib/grayscale-frame";
import type { GrayscaleFrame } from "@/lib/shared-types";

interface GrayscaleCanvasProps {
  frame: GrayscaleFrame | null;
  renderWhenOffscreen?: boolean;
}

export const GrayscaleCanvas = memo(function GrayscaleCanvas({
  frame,
  renderWhenOffscreen = false,
}: GrayscaleCanvasProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const backingCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const didWarnInvalidFrameRef = useRef(false);
  const [isVisible, setIsVisible] = useState(false);
  const shouldRender = renderWhenOffscreen || isVisible;

  useLayoutEffect(() => {
    if (renderWhenOffscreen) return;
    const element = frameRef.current;
    if (!element) return;

    if (!("IntersectionObserver" in window)) {
      setIsVisible(true);
      return;
    }

    const bounds = element.getBoundingClientRect();
    setIsVisible(
      bounds.bottom > 0 &&
        bounds.right > 0 &&
        bounds.top < window.innerHeight &&
        bounds.left < window.innerWidth,
    );

    const observer = new IntersectionObserver(([entry]) => {
      setIsVisible((current) =>
        current === entry.isIntersecting ? current : entry.isIntersecting,
      );
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, [renderWhenOffscreen]);

  useEffect(() => {
    const backingCanvas = backingCanvasRef.current;
    const frameElement = frameRef.current;
    if (!backingCanvas || !frameElement) return;

    if (!frame) {
      clearRenderer(backingCanvas);
      imageDataRef.current = null;
      didWarnInvalidFrameRef.current = false;
      return;
    }

    frameElement.style.setProperty("--frame-columns", String(frame.width));
    frameElement.style.setProperty("--frame-rows", String(frame.height));

    if (!shouldRender) return;

    let image: ImageData;

    try {
      image = unpackGrayscaleFrame(frame, imageDataRef.current ?? undefined);
      imageDataRef.current = image;
      didWarnInvalidFrameRef.current = false;
    } catch (error) {
      clearRenderer(backingCanvas);
      imageDataRef.current = null;

      if (!didWarnInvalidFrameRef.current) {
        didWarnInvalidFrameRef.current = true;
        console.warn("Ignoring invalid grayscale frame", error);
      }
      return;
    }

    const context = backingCanvas.getContext("2d", { alpha: false });
    if (!context) return;

    if (
      backingCanvas.width !== frame.width ||
      backingCanvas.height !== frame.height
    ) {
      backingCanvas.width = frame.width;
      backingCanvas.height = frame.height;
      context.imageSmoothingEnabled = false;
    }
    context.putImageData(image, 0, 0);
  }, [frame, shouldRender]);

  return (
    <div
      aria-label="Low-resolution grayscale camera image"
      className="grayscale-canvas"
      data-room-part="video-frame"
      ref={frameRef}
      role="img"
    >
      <canvas
        aria-hidden="true"
        className="grayscale-canvas-backing"
        ref={backingCanvasRef}
      />
    </div>
  );
});

function clearRenderer(backingCanvas: HTMLCanvasElement) {
  backingCanvas.width = 1;
  backingCanvas.height = 1;
}

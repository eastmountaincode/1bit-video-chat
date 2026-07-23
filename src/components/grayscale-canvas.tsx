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
  livePixelMetadata?: boolean;
  maxPixelCells?: number;
  pixelOverlayEnabled?: boolean;
  renderWhenOffscreen?: boolean;
}

interface PixelGridState {
  bitCount: number;
  hasLiveMetadata: boolean;
  height: number;
  levels: Uint8Array;
  nodes: HTMLSpanElement[];
  width: number;
}

export const GrayscaleCanvas = memo(function GrayscaleCanvas({
  frame,
  livePixelMetadata = false,
  maxPixelCells,
  pixelOverlayEnabled = true,
  renderWhenOffscreen = false,
}: GrayscaleCanvasProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const backingCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageDataRef = useRef<ImageData | null>(null);
  const pixelStateRef = useRef<PixelGridState | null>(null);
  const didWarnInvalidFrameRef = useRef(false);
  const [isVisible, setIsVisible] = useState(false);
  const shouldRender = renderWhenOffscreen || isVisible;
  const usePixelCells = livePixelMetadata && pixelOverlayEnabled;

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
      clearRenderer(backingCanvas, frameElement);
      imageDataRef.current = null;
      pixelStateRef.current = null;
      didWarnInvalidFrameRef.current = false;
      return;
    }

    frameElement.style.setProperty("--frame-columns", String(frame.width));
    frameElement.style.setProperty("--frame-rows", String(frame.height));

    if (!shouldRender) {
      if (pixelStateRef.current) {
        clearPixelGrid(frameElement, backingCanvas);
        pixelStateRef.current = null;
      }
      return;
    }

    let image: ImageData;

    try {
      image = unpackGrayscaleFrame(frame, imageDataRef.current ?? undefined);
      imageDataRef.current = image;
      didWarnInvalidFrameRef.current = false;
    } catch (error) {
      clearRenderer(backingCanvas, frameElement);
      imageDataRef.current = null;
      pixelStateRef.current = null;

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

    if (!pixelOverlayEnabled) {
      if (pixelStateRef.current) {
        clearPixelGrid(frameElement, backingCanvas);
        pixelStateRef.current = null;
      }
      return;
    }

    const pixelDimensions = getPixelGridDimensions(
      frame.width,
      frame.height,
      maxPixelCells,
    );
    frameElement.style.setProperty("--pixel-columns", String(pixelDimensions.width));
    frameElement.style.setProperty("--pixel-rows", String(pixelDimensions.height));
    const pixelCount = pixelDimensions.width * pixelDimensions.height;
    let pixelState = pixelStateRef.current;

    if (
      !pixelState ||
      pixelState.width !== pixelDimensions.width ||
      pixelState.height !== pixelDimensions.height
    ) {
      pixelState = createPixelGrid(
        frameElement,
        backingCanvas,
        pixelDimensions.width,
        pixelDimensions.height,
      );
      pixelStateRef.current = pixelState;
    }

    if (!usePixelCells) {
      clearLivePixelMetadata(pixelState);
      return;
    }

    const bitCount = frame.bits ?? 4;
    const maximumLevel = (1 << bitCount) - 1;
    const bitCountChanged = pixelState.bitCount !== bitCount;
    pixelState.bitCount = bitCount;
    pixelState.hasLiveMetadata = true;

    for (let index = 0; index < pixelCount; index += 1) {
      const pixelX = index % pixelDimensions.width;
      const pixelY = Math.floor(index / pixelDimensions.width);
      const sourceX = Math.min(
        frame.width - 1,
        Math.floor(((pixelX + 0.5) * frame.width) / pixelDimensions.width),
      );
      const sourceY = Math.min(
        frame.height - 1,
        Math.floor(((pixelY + 0.5) * frame.height) / pixelDimensions.height),
      );
      const gray = image.data[(sourceY * frame.width + sourceX) * 4];
      const level = Math.round((gray / 255) * maximumLevel);

      if (!bitCountChanged && pixelState.levels[index] === level) continue;

      const pixel = pixelState.nodes[index];
      pixelState.levels[index] = level;
      pixel.classList.add("grayscale-pixel-live");
      pixel.dataset.pixelLevel = String(level);
      pixel.style.setProperty("--pixel-gray", String(gray));
      pixel.style.setProperty("--pixel-level", String(level));
    }
  }, [
    frame,
    maxPixelCells,
    pixelOverlayEnabled,
    shouldRender,
    usePixelCells,
  ]);

  return (
    <div
      aria-label="Low-resolution grayscale camera image"
      className="grayscale-canvas grayscale-pixels"
      data-pixel-source={usePixelCells ? "cells" : "canvas"}
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

function createPixelGrid(
  frameElement: HTMLDivElement,
  backingCanvas: HTMLCanvasElement,
  width: number,
  height: number,
): PixelGridState {
  const pixelCount = width * height;
  const fragment = document.createDocumentFragment();
  const nodes = Array.from({ length: pixelCount }, (_, index) => {
    const pixel = document.createElement("span");
    const x = index % width;
    const y = Math.floor(index / width);

    pixel.className = "grayscale-pixel";
    pixel.dataset.pixelIndex = String(index);
    pixel.dataset.pixelX = String(x);
    pixel.dataset.pixelY = String(y);
    pixel.dataset.roomPart = "video-pixel";
    pixel.style.setProperty("--pixel-index", String(index));
    pixel.style.setProperty("--pixel-x", String(x));
    pixel.style.setProperty("--pixel-y", String(y));
    fragment.append(pixel);

    return pixel;
  });

  clearPixelGrid(frameElement, backingCanvas);
  frameElement.append(fragment);

  return {
    bitCount: 0,
    hasLiveMetadata: false,
    height,
    levels: new Uint8Array(pixelCount).fill(255),
    nodes,
    width,
  };
}

function clearLivePixelMetadata(pixelState: PixelGridState) {
  if (!pixelState.hasLiveMetadata) return;

  for (const pixel of pixelState.nodes) {
    delete pixel.dataset.pixelLevel;
    pixel.classList.remove("grayscale-pixel-live");
    pixel.style.removeProperty("--pixel-gray");
    pixel.style.removeProperty("--pixel-level");
  }

  pixelState.bitCount = 0;
  pixelState.hasLiveMetadata = false;
  pixelState.levels.fill(255);
}

function clearRenderer(
  backingCanvas: HTMLCanvasElement,
  frameElement: HTMLDivElement,
) {
  backingCanvas.width = 1;
  backingCanvas.height = 1;
  clearPixelGrid(frameElement, backingCanvas);
}

function clearPixelGrid(
  frameElement: HTMLDivElement,
  backingCanvas: HTMLCanvasElement,
) {
  frameElement.replaceChildren(backingCanvas);
}

function getPixelGridDimensions(
  width: number,
  height: number,
  maximumCells: number | undefined,
) {
  if (
    maximumCells === undefined ||
    !Number.isFinite(maximumCells) ||
    width * height <= maximumCells
  ) {
    return { height, width };
  }

  const safeMaximumCells = Math.max(1, Math.floor(maximumCells));
  const scale = Math.sqrt(safeMaximumCells / (width * height));
  let scaledWidth = Math.max(1, Math.floor(width * scale));
  let scaledHeight = Math.max(1, Math.floor(height * scale));

  while (scaledWidth * scaledHeight > safeMaximumCells) {
    if (scaledWidth / width >= scaledHeight / height) {
      scaledWidth = Math.max(1, scaledWidth - 1);
    } else {
      scaledHeight = Math.max(1, scaledHeight - 1);
    }
  }

  return { height: scaledHeight, width: scaledWidth };
}

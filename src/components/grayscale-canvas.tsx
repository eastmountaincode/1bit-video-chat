"use client";

import { useEffect, useRef } from "react";

import { unpackGrayscaleFrame } from "@/lib/grayscale-frame";
import type { GrayscaleFrame } from "@/lib/shared-types";

interface GrayscaleCanvasProps {
  frame: GrayscaleFrame | null;
}

export function GrayscaleCanvas({ frame }: GrayscaleCanvasProps) {
  const pixelGridRef = useRef<HTMLDivElement>(null);
  const pixelStateRef = useRef<{
    bitCount: number;
    height: number;
    levels: Uint8Array;
    nodes: HTMLSpanElement[];
    width: number;
  } | null>(null);

  useEffect(() => {
    const pixelGrid = pixelGridRef.current;
    if (!pixelGrid) return;

    if (!frame) {
      pixelGrid.replaceChildren();
      pixelStateRef.current = null;
      return;
    }

    const pixelCount = frame.width * frame.height;
    let pixelState = pixelStateRef.current;

    if (
      !pixelState ||
      pixelState.width !== frame.width ||
      pixelState.height !== frame.height
    ) {
      const fragment = document.createDocumentFragment();
      const nodes = Array.from({ length: pixelCount }, (_, index) => {
        const pixel = document.createElement("span");
        const x = index % frame.width;
        const y = Math.floor(index / frame.width);

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

      pixelGrid.replaceChildren(fragment);
      pixelGrid.style.setProperty("--pixel-columns", String(frame.width));
      pixelGrid.style.setProperty("--pixel-rows", String(frame.height));

      pixelState = {
        bitCount: 0,
        height: frame.height,
        levels: new Uint8Array(pixelCount).fill(255),
        nodes,
        width: frame.width,
      };
      pixelStateRef.current = pixelState;
    }

    const image = unpackGrayscaleFrame(frame);
    const bitCount = Math.max(1, Math.min(5, Math.round(frame.bits ?? 4)));
    const maximumLevel = (1 << bitCount) - 1;
    const bitCountChanged = pixelState.bitCount !== bitCount;
    pixelState.bitCount = bitCount;

    for (let index = 0; index < pixelCount; index += 1) {
      const gray = image.data[index * 4];
      const level = Math.round((gray / 255) * maximumLevel);

      if (!bitCountChanged && pixelState.levels[index] === level) continue;

      const pixel = pixelState.nodes[index];
      pixelState.levels[index] = level;
      pixel.dataset.pixelLevel = String(level);
      pixel.style.setProperty("--pixel-gray", String(gray));
      pixel.style.setProperty("--pixel-level", String(level));
    }
  }, [frame]);

  return (
    <div
      aria-label="Low-resolution grayscale camera image"
      className="grayscale-canvas grayscale-pixels"
      data-room-part="video-frame"
      ref={pixelGridRef}
      role="img"
    />
  );
}

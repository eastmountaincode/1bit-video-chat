"use client";

import { useEffect, useRef } from "react";

import { unpackGrayscaleFrame } from "@/lib/grayscale-frame";
import type { GrayscaleFrame } from "@/lib/shared-types";

interface GrayscaleCanvasProps {
  frame: GrayscaleFrame | null;
}

export function GrayscaleCanvas({ frame }: GrayscaleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame) return;

    const context = canvas.getContext("2d", { alpha: false });
    if (!context) return;

    canvas.width = frame.width;
    canvas.height = frame.height;
    context.putImageData(unpackGrayscaleFrame(frame), 0, 0);
  }, [frame]);

  return (
    <canvas
      aria-label="Low-resolution grayscale camera image"
      className="grayscale-canvas"
      ref={canvasRef}
    />
  );
}

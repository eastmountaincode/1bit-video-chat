"use client";

import { useEffect, useState } from "react";

import { GrayscaleCanvas } from "@/components/grayscale-canvas";
import type {
  GrayscaleFrame,
  VideoPayloadRate,
} from "@/lib/shared-types";
import {
  getVideoPayloadRateLifetime,
  normalizeVideoPayloadRate,
} from "@/lib/video-payload-rate";

interface VideoTileProps {
  frame: GrayscaleFrame | null;
  isMe?: boolean;
  name: string;
  payloadRate?: VideoPayloadRate | null;
}

export function VideoTile({
  frame,
  isMe = false,
  name,
  payloadRate,
}: VideoTileProps) {
  const normalizedPayloadRate = normalizeVideoPayloadRate(payloadRate);
  const measurementId = normalizedPayloadRate?.measuredAt ?? null;
  const remainingLifetime = normalizedPayloadRate
    ? getVideoPayloadRateLifetime(normalizedPayloadRate)
    : 0;
  const [expiredMeasurementId, setExpiredMeasurementId] = useState<
    number | null
  >(null);

  useEffect(() => {
    if (measurementId === null || remainingLifetime <= 0) return;

    const expiryTimer = window.setTimeout(() => {
      setExpiredMeasurementId(measurementId);
    }, remainingLifetime);

    return () => window.clearTimeout(expiryTimer);
  }, [measurementId, remainingLifetime]);

  const isExpired =
    measurementId !== null &&
    (remainingLifetime <= 0 || expiredMeasurementId === measurementId);
  const rateLabel = formatPayloadRate(normalizedPayloadRate, isExpired);

  return (
    <figure
      className="video-tile"
      data-room-part="video-card"
      data-video-side={isMe ? "own" : "other"}
    >
      <GrayscaleCanvas frame={frame} />
      <figcaption data-room-part="video-caption">
        <span className="video-caption-name">
          {name}
          {isMe ? " (you)" : ""}
        </span>
        <span
          aria-label={rateLabel.accessible}
          className="video-rate"
          data-rate-kind="encoded-video-payload"
          data-room-part="video-rate"
          title="Encoded video payload rate. PlayHTML transport overhead is not included."
        >
          {rateLabel.visible}
        </span>
      </figcaption>
    </figure>
  );
}

function formatPayloadRate(
  payloadRate: VideoPayloadRate | null | undefined,
  isExpired: boolean,
) {
  if (!payloadRate) {
    return {
      accessible: "Video payload rate unavailable",
      visible: "— kB/s",
    };
  }

  const bytesPerSecond = payloadRate.bytesPerSecond;
  const isValid =
    Number.isFinite(bytesPerSecond) && bytesPerSecond >= 0;

  if (!isValid) {
    return {
      accessible: "Video payload rate unavailable",
      visible: "— kB/s",
    };
  }

  const kilobytesPerSecond = isExpired ? 0 : bytesPerSecond / 1_000;
  const value =
    kilobytesPerSecond === 0
      ? "0"
      : kilobytesPerSecond.toFixed(1);

  return {
    accessible: `Encoded video payload rate: ${value} kilobytes per second`,
    visible: `${value} kB/s`,
  };
}

"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";

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
  livePixelMetadata?: boolean;
  maxPixelCells?: number;
  name: string;
  payloadRate?: VideoPayloadRate | null;
  pixelOverlayEnabled?: boolean;
  renderWhenOffscreen?: boolean;
}

export const VideoTile = memo(function VideoTile({
  frame,
  isMe = false,
  livePixelMetadata = false,
  maxPixelCells,
  name,
  payloadRate,
  pixelOverlayEnabled = true,
  renderWhenOffscreen = false,
}: VideoTileProps) {
  const normalizedPayloadRate = normalizeVideoPayloadRate(payloadRate);
  const measurementId = normalizedPayloadRate?.measuredAt ?? null;
  const measurementWindow = normalizedPayloadRate?.windowMs ?? null;
  const measuredBytesPerSecond =
    normalizedPayloadRate?.bytesPerSecond ?? null;
  const expiry = useMemo(() => {
    if (
      measurementId === null ||
      measurementWindow === null ||
      measuredBytesPerSecond === null
    ) {
      return null;
    }

    const remainingLifetime = getVideoPayloadRateLifetime(
      {
        bytesPerSecond: measuredBytesPerSecond,
        measuredAt: measurementId,
        windowMs: measurementWindow,
      },
    );
    return {
      expiresAt: Date.now() + remainingLifetime,
      measurementId,
      remainingLifetime,
    };
  }, [measuredBytesPerSecond, measurementId, measurementWindow]);
  const expiryTargetRef = useRef<{
    expiresAt: number;
    measurementId: number;
  } | null>(null);
  const expiryTimerRef = useRef<number | null>(null);
  const expiryTimerDueAtRef = useRef<number | null>(null);
  const [expiredMeasurementId, setExpiredMeasurementId] = useState<
    number | null
  >(null);

  useEffect(() => {
    if (!expiry) {
      expiryTargetRef.current = null;
      if (expiryTimerRef.current !== null) {
        window.clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
        expiryTimerDueAtRef.current = null;
      }
      return;
    }

    expiryTargetRef.current = {
      expiresAt: expiry.expiresAt,
      measurementId: expiry.measurementId,
    };

    if (expiry.remainingLifetime <= 0) {
      if (expiryTimerRef.current !== null) {
        window.clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
        expiryTimerDueAtRef.current = null;
      }
      setExpiredMeasurementId(expiry.measurementId);
      return;
    }

    if (expiryTimerRef.current !== null) {
      if ((expiryTimerDueAtRef.current ?? Infinity) <= expiry.expiresAt) {
        return;
      }

      window.clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
      expiryTimerDueAtRef.current = null;
    }

    function checkExpiry() {
      const target = expiryTargetRef.current;
      if (!target) {
        expiryTimerRef.current = null;
        expiryTimerDueAtRef.current = null;
        return;
      }

      const remainingLifetime = target.expiresAt - Date.now();
      if (remainingLifetime > 0) {
        expiryTimerDueAtRef.current = target.expiresAt;
        expiryTimerRef.current = window.setTimeout(
          checkExpiry,
          remainingLifetime,
        );
        return;
      }

      expiryTimerRef.current = null;
      expiryTimerDueAtRef.current = null;
      setExpiredMeasurementId(target.measurementId);
    }

    expiryTimerDueAtRef.current = expiry.expiresAt;
    expiryTimerRef.current = window.setTimeout(
      checkExpiry,
      expiry.remainingLifetime,
    );
  }, [expiry]);

  useEffect(
    () => () => {
      if (expiryTimerRef.current !== null) {
        window.clearTimeout(expiryTimerRef.current);
      }
      expiryTimerRef.current = null;
      expiryTimerDueAtRef.current = null;
    },
    [],
  );

  const isExpired =
    measurementId !== null &&
    ((expiry?.remainingLifetime ?? 0) <= 0 ||
      expiredMeasurementId === measurementId);
  const rateLabel = formatPayloadRate(normalizedPayloadRate, isExpired);

  return (
    <figure
      className="video-tile"
      data-room-part="video-card"
      data-video-side={isMe ? "own" : "other"}
    >
      <GrayscaleCanvas
        frame={frame}
        livePixelMetadata={livePixelMetadata}
        maxPixelCells={maxPixelCells}
        pixelOverlayEnabled={pixelOverlayEnabled}
        renderWhenOffscreen={renderWhenOffscreen}
      />
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
}, areVideoTilePropsEqual);

function areVideoTilePropsEqual(
  previous: VideoTileProps,
  next: VideoTileProps,
) {
  return (
    previous.name === next.name &&
    Boolean(previous.isMe) === Boolean(next.isMe) &&
    Boolean(previous.livePixelMetadata) ===
      Boolean(next.livePixelMetadata) &&
    previous.maxPixelCells === next.maxPixelCells &&
    (previous.pixelOverlayEnabled ?? true) ===
      (next.pixelOverlayEnabled ?? true) &&
    Boolean(previous.renderWhenOffscreen) ===
      Boolean(next.renderWhenOffscreen) &&
    framesEqual(previous.frame, next.frame) &&
    payloadRatesEqual(previous.payloadRate, next.payloadRate)
  );
}

function framesEqual(
  previous: GrayscaleFrame | null,
  next: GrayscaleFrame | null,
) {
  if (previous === next) return true;
  if (!previous || !next) return false;

  return (
    previous.bits === next.bits &&
    previous.data === next.data &&
    previous.height === next.height &&
    previous.width === next.width
  );
}

function payloadRatesEqual(
  previous: VideoPayloadRate | null | undefined,
  next: VideoPayloadRate | null | undefined,
) {
  if (previous === next) return true;
  if (!previous || !next) return false;

  return (
    previous.bytesPerSecond === next.bytesPerSecond &&
    previous.measuredAt === next.measuredAt &&
    previous.windowMs === next.windowMs
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

"use client";

import type { CaptureSettings } from "@/lib/capture-settings";

interface HelperPanelProps {
  active: boolean;
  effectiveSettings: CaptureSettings;
  onChange: (settings: CaptureSettings) => void;
  participantCount: number;
  settings: CaptureSettings;
}

export function HelperPanel({
  active,
  effectiveSettings,
  onChange,
  participantCount,
  settings,
}: HelperPanelProps) {
  const resolutionAdjusted =
    effectiveSettings.width !== settings.width ||
    effectiveSettings.height !== settings.height;
  const bitDepthAdjusted =
    effectiveSettings.grayscaleBits !== settings.grayscaleBits;
  const frameRateAdjusted =
    effectiveSettings.frameRate !== settings.frameRate;
  const isAdjusted =
    resolutionAdjusted || bitDepthAdjusted || frameRateAdjusted;

  function updateWidth(width: number) {
    onChange({
      ...settings,
      height: Math.round(width * 0.75),
      width,
    });
  }

  return (
    <fieldset
      className="settings-panel sidebar-panel"
      data-room-part="settings"
      hidden={!active}
    >
      <legend>settings</legend>

      <label>
        <span>resolution</span>
        <input
          max={216}
          min={8}
          onChange={(event) => updateWidth(Number(event.target.value))}
          step={4}
          type="range"
          value={settings.width}
        />
        <output>
          {settings.width} × {settings.height}
          {resolutionAdjusted
            ? ` → ${effectiveSettings.width} × ${effectiveSettings.height}`
            : ""}
        </output>
      </label>

      <label>
        <span>gray bits</span>
        <input
          max={5}
          min={1}
          onChange={(event) =>
            onChange({
              ...settings,
              grayscaleBits: Number(event.target.value),
            })
          }
          step={1}
          type="range"
          value={settings.grayscaleBits}
        />
        <output>
          {settings.grayscaleBits}
          {bitDepthAdjusted
            ? ` → ${effectiveSettings.grayscaleBits}`
            : ""}
        </output>
      </label>

      <label>
        <span>fps</span>
        <input
          max={20}
          min={1}
          onChange={(event) =>
            onChange({
              ...settings,
              frameRate: Number(event.target.value),
            })
          }
          step={1}
          type="range"
          value={settings.frameRate}
        />
        <output>
          {settings.frameRate}
          {frameRateAdjusted ? ` → ${effectiveSettings.frameRate}` : ""}
        </output>
      </label>

      {isAdjusted ? (
        <p aria-live="polite" className="settings-room-limit">
          Room safeguard active for {participantCount}{" "}
          {participantCount === 1 ? "participant" : "participants"}. The
          value after the arrow is being sent.
        </p>
      ) : null}
    </fieldset>
  );
}

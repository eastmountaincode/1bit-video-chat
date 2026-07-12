"use client";

import type { CaptureSettings } from "@/lib/capture-settings";

interface HelperPanelProps {
  onChange: (settings: CaptureSettings) => void;
  settings: CaptureSettings;
}

export function HelperPanel({ onChange, settings }: HelperPanelProps) {
  function updateWidth(width: number) {
    onChange({
      ...settings,
      height: Math.round(width * 0.75),
      width,
    });
  }

  return (
    <fieldset className="helper-panel">
      <legend>helper</legend>

      <label>
        <span>resolution</span>
        <input
          max={88}
          min={48}
          onChange={(event) => updateWidth(Number(event.target.value))}
          step={4}
          type="range"
          value={settings.width}
        />
        <output>
          {settings.width} × {settings.height}
        </output>
      </label>

      <label>
        <span>gray bits</span>
        <input
          max={4}
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
        <output>{settings.grayscaleBits}</output>
      </label>

      <label>
        <span>fps</span>
        <input
          max={15}
          min={5}
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
        <output>{settings.frameRate}</output>
      </label>
    </fieldset>
  );
}

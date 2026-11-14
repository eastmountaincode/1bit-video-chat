"use client";

import { ResolutionControl } from "@/components/resolution-control";
import {
  CAPTURE_SETTINGS_LIMITS,
  type CaptureSettings,
} from "@/lib/capture-settings";

interface HelperPanelProps {
  active: boolean;
  onChange: (settings: CaptureSettings) => void;
  settings: CaptureSettings;
}

export function HelperPanel({
  active,
  onChange,
  settings,
}: HelperPanelProps) {
  return (
    <fieldset
      className="settings-panel sidebar-panel"
      data-room-part="settings"
      hidden={!active}
    >
      <legend>settings</legend>

        <ResolutionControl onChange={onChange} settings={settings} />

      <label>
        <span>gray bits</span>
        <input
          max={CAPTURE_SETTINGS_LIMITS.grayscaleBits.max}
          min={CAPTURE_SETTINGS_LIMITS.grayscaleBits.min}
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
          max={CAPTURE_SETTINGS_LIMITS.frameRate.max}
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
        <output>{settings.frameRate}</output>
      </label>
    </fieldset>
  );
}

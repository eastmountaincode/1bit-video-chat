"use client";

import { CAPTURE_SETTINGS_LIMITS, type CaptureSettings } from "@/lib/capture-settings";

interface ResolutionControlProps {
    onChange: (settings: CaptureSettings) => void;
    settings: CaptureSettings;
}

export function ResolutionControl({ onChange, settings }: ResolutionControlProps) {
    function updateWidth(width: number) {
        onChange({
            ...settings,
            height: Math.round(width * 0.75),
            width,
        });
    }

    return (
        <label className="resolution-control">
            <span>resolution</span>
            <input
                aria-valuetext={`${settings.width} by ${settings.height} pixels`}
                max={CAPTURE_SETTINGS_LIMITS.width.max}
                min={CAPTURE_SETTINGS_LIMITS.width.min}
                onChange={(event) => updateWidth(Number(event.target.value))}
                step={4}
                type="range"
                value={settings.width}
            />
            <output>{settings.width} × {settings.height}</output>
        </label>
    );
}

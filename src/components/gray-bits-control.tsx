"use client";

import { CAPTURE_SETTINGS_LIMITS, type CaptureSettings } from "@/lib/capture-settings";

interface GrayBitsControlProps {
    onChange: (settings: CaptureSettings) => void;
    settings: CaptureSettings;
}

export function GrayBitsControl({ onChange, settings }: GrayBitsControlProps) {
    return (
        <label className="gray-bits-control">
            <span>gray bits</span>
            <input
                aria-valuetext={`${settings.grayscaleBits} bits, ${2 ** settings.grayscaleBits} shades`}
                max={CAPTURE_SETTINGS_LIMITS.grayscaleBits.max}
                min={CAPTURE_SETTINGS_LIMITS.grayscaleBits.min}
                onChange={(event) => onChange({
                    ...settings,
                    grayscaleBits: Number(event.target.value),
                })}
                step={1}
                type="range"
                value={settings.grayscaleBits}
            />
            <output>{settings.grayscaleBits}</output>
        </label>
    );
}

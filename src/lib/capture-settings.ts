export interface CaptureSettings {
  frameRate: number;
  grayscaleBits: number;
  height: number;
  width: number;
}

export const CAPTURE_SETTINGS_LIMITS = {
  frameRate: { min: 1, max: 15 },
  grayscaleBits: { min: 1, max: 4 },
  height: { min: 6, max: 96 },
  width: { min: 8, max: 128 },
} as const;

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  frameRate: 15,
  grayscaleBits: 3,
  height: 75,
  width: 100,
};

export function normalizeCaptureSettings(
  settings: CaptureSettings,
): CaptureSettings {
  return {
    frameRate: clampInteger(
      settings.frameRate,
      CAPTURE_SETTINGS_LIMITS.frameRate.min,
      CAPTURE_SETTINGS_LIMITS.frameRate.max,
    ),
    grayscaleBits: clampInteger(
      settings.grayscaleBits,
      CAPTURE_SETTINGS_LIMITS.grayscaleBits.min,
      CAPTURE_SETTINGS_LIMITS.grayscaleBits.max,
    ),
    height: clampInteger(
      settings.height,
      CAPTURE_SETTINGS_LIMITS.height.min,
      CAPTURE_SETTINGS_LIMITS.height.max,
    ),
    width: clampInteger(
      settings.width,
      CAPTURE_SETTINGS_LIMITS.width.min,
      CAPTURE_SETTINGS_LIMITS.width.max,
    ),
  };
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

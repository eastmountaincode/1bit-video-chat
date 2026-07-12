export interface CaptureSettings {
  frameRate: number;
  grayscaleBits: number;
  height: number;
  width: number;
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  frameRate: 12,
  grayscaleBits: 3,
  height: 84,
  width: 112,
};

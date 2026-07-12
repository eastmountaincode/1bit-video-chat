export interface CaptureSettings {
  frameRate: number;
  grayscaleBits: number;
  height: number;
  width: number;
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  frameRate: 15,
  grayscaleBits: 3,
  height: 75,
  width: 100,
};

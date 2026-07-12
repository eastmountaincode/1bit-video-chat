import { DEFAULT_CAPTURE_SETTINGS } from "@/lib/capture-settings";
import type { GrayscaleFrame } from "@/lib/shared-types";

export function packGrayscaleFrame(
  pixels: Uint8ClampedArray,
  width = DEFAULT_CAPTURE_SETTINGS.width,
  height = DEFAULT_CAPTURE_SETTINGS.height,
  grayscaleBits = DEFAULT_CAPTURE_SETTINGS.grayscaleBits,
): GrayscaleFrame {
  const pixelCount = width * height;
  const packed = new Uint8Array(Math.ceil(pixelCount / 2));
  const bitCount = Math.max(1, Math.min(4, Math.round(grayscaleBits)));
  const maximumQuantizedLevel = (1 << bitCount) - 1;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const rgbaIndex = pixelIndex * 4;
    const luminance =
      (pixels[rgbaIndex] * 54 +
        pixels[rgbaIndex + 1] * 183 +
        pixels[rgbaIndex + 2] * 19) >>
      8;
    const quantizedLevel = Math.round(
      (luminance / 255) * maximumQuantizedLevel,
    );
    const level = Math.round(
      (quantizedLevel / maximumQuantizedLevel) * 15,
    );

    if ((pixelIndex & 1) === 0) {
      packed[pixelIndex >> 1] = level << 4;
    } else {
      packed[pixelIndex >> 1] |= level;
    }
  }

  let binary = "";
  for (const byte of packed) {
    binary += String.fromCharCode(byte);
  }

  return {
    data: window.btoa(binary),
    height,
    width,
  };
}

export function unpackGrayscaleFrame(frame: GrayscaleFrame): ImageData {
  const binary = window.atob(frame.data);
  const image = new ImageData(frame.width, frame.height);
  const pixelCount = frame.width * frame.height;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const byte = binary.charCodeAt(pixelIndex >> 1);
    const level = (pixelIndex & 1) === 0 ? byte >> 4 : byte & 0x0f;
    const value = level * 17;
    const rgbaIndex = pixelIndex * 4;

    image.data[rgbaIndex] = value;
    image.data[rgbaIndex + 1] = value;
    image.data[rgbaIndex + 2] = value;
    image.data[rgbaIndex + 3] = 255;
  }

  return image;
}

import { DEFAULT_CAPTURE_SETTINGS } from "@/lib/capture-settings";
import type { GrayscaleFrame } from "@/lib/shared-types";

export function packGrayscaleFrame(
  pixels: Uint8ClampedArray,
  width = DEFAULT_CAPTURE_SETTINGS.width,
  height = DEFAULT_CAPTURE_SETTINGS.height,
  grayscaleBits = DEFAULT_CAPTURE_SETTINGS.grayscaleBits,
): GrayscaleFrame {
  const pixelCount = width * height;
  const bitCount = Math.max(1, Math.min(5, Math.round(grayscaleBits)));
  const packed = new Uint8Array(Math.ceil((pixelCount * bitCount) / 8));
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
    const bitOffset = pixelIndex * bitCount;

    for (let bitIndex = 0; bitIndex < bitCount; bitIndex += 1) {
      const absoluteBit = bitOffset + bitIndex;
      const value =
        (quantizedLevel >> (bitCount - bitIndex - 1)) & 1;
      packed[absoluteBit >> 3] |= value << (7 - (absoluteBit & 7));
    }
  }

  let binary = "";
  for (const byte of packed) {
    binary += String.fromCharCode(byte);
  }

  return {
    bits: bitCount,
    data: window.btoa(binary),
    height,
    width,
  };
}

export function unpackGrayscaleFrame(frame: GrayscaleFrame): ImageData {
  const binary = window.atob(frame.data);
  const image = new ImageData(frame.width, frame.height);
  const pixelCount = frame.width * frame.height;
  const bitCount = Math.max(1, Math.min(5, Math.round(frame.bits ?? 4)));
  const maximumQuantizedLevel = (1 << bitCount) - 1;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const bitOffset = pixelIndex * bitCount;
    let quantizedLevel = 0;

    for (let bitIndex = 0; bitIndex < bitCount; bitIndex += 1) {
      const absoluteBit = bitOffset + bitIndex;
      const byte = binary.charCodeAt(absoluteBit >> 3);
      const bit = (byte >> (7 - (absoluteBit & 7))) & 1;
      quantizedLevel = (quantizedLevel << 1) | bit;
    }

    const value = Math.round(
      (quantizedLevel / maximumQuantizedLevel) * 255,
    );
    const rgbaIndex = pixelIndex * 4;

    image.data[rgbaIndex] = value;
    image.data[rgbaIndex + 1] = value;
    image.data[rgbaIndex + 2] = value;
    image.data[rgbaIndex + 3] = 255;
  }

  return image;
}

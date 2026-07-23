import assert from "node:assert/strict";
import test from "node:test";

import {
  createGrayscaleFrameEncoder,
  packGrayscaleFrame,
  unpackGrayscaleFrame,
} from "./grayscale-frame.ts";

class TestImageData {
  readonly colorSpace = "srgb" as const;
  readonly data: Uint8ClampedArray;
  readonly height: number;
  readonly width: number;

  constructor(width: number, height: number) {
    this.height = height;
    this.width = width;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

Object.defineProperty(globalThis, "ImageData", {
  configurable: true,
  value: TestImageData,
});

test("optimized encoder preserves the original bit packing", () => {
  const pixels = new Uint8ClampedArray(13 * 7 * 4);
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = (index * 47 + 13) % 256;
  }

  for (let bitCount = 1; bitCount <= 5; bitCount += 1) {
    const frame = packGrayscaleFrame(pixels, 13, 7, bitCount);
    assert.equal(frame.data, referencePack(pixels, 13, 7, bitCount));
  }
});

test("reusable encoder overwrites every byte between frames", () => {
  const encode = createGrayscaleFrameEncoder(3, 1, 3);
  const white = new Uint8ClampedArray(12).fill(255);
  const black = new Uint8ClampedArray(12);

  assert.notEqual(encode(white).data, encode(black).data);
  assert.equal(encode(black).data, referencePack(black, 3, 1, 3));
  assert.equal(encode(white).data, referencePack(white, 3, 1, 3));
});

test("decoder reuses ImageData and replaces its pixels", () => {
  const encode = createGrayscaleFrameEncoder(2, 1, 2);
  const black = new Uint8ClampedArray(8);
  const white = new Uint8ClampedArray(8).fill(255);
  const image = unpackGrayscaleFrame(encode(black));
  const reused = unpackGrayscaleFrame(encode(white), image);

  assert.equal(reused, image);
  assert.deepEqual(Array.from(reused.data), [
    255,
    255,
    255,
    255,
    255,
    255,
    255,
    255,
  ]);
});

function referencePack(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  bitCount: number,
) {
  const pixelCount = width * height;
  const packed = new Uint8Array(Math.ceil((pixelCount * bitCount) / 8));
  const maximumLevel = (1 << bitCount) - 1;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const rgbaIndex = pixelIndex * 4;
    const luminance =
      (pixels[rgbaIndex] * 54 +
        pixels[rgbaIndex + 1] * 183 +
        pixels[rgbaIndex + 2] * 19) >>
      8;
    const level = Math.round((luminance / 255) * maximumLevel);
    const bitOffset = pixelIndex * bitCount;

    for (let bitIndex = 0; bitIndex < bitCount; bitIndex += 1) {
      const absoluteBit = bitOffset + bitIndex;
      const value = (level >> (bitCount - bitIndex - 1)) & 1;
      packed[absoluteBit >> 3] |= value << (7 - (absoluteBit & 7));
    }
  }

  return globalThis.btoa(String.fromCharCode(...packed));
}

import { DEFAULT_CAPTURE_SETTINGS } from "./capture-settings.ts";
import type { GrayscaleFrame } from "./shared-types.ts";

const MAX_FRAME_WIDTH = 216;
const MAX_FRAME_HEIGHT = 162;
const GRAYSCALE_LEVELS = Array.from({ length: 5 }, (_, index) => {
  const bitCount = index + 1;
  const maximumLevel = (1 << bitCount) - 1;

  return Uint8Array.from({ length: maximumLevel + 1 }, (_, level) =>
    Math.round((level / maximumLevel) * 255),
  );
});

export function createGrayscaleFrameEncoder(
  width = DEFAULT_CAPTURE_SETTINGS.width,
  height = DEFAULT_CAPTURE_SETTINGS.height,
  grayscaleBits = DEFAULT_CAPTURE_SETTINGS.grayscaleBits,
) {
  const { bitCount, pixelCount } = validateFrameShape(
    width,
    height,
    grayscaleBits,
  );
  const packed = new Uint8Array(Math.ceil((pixelCount * bitCount) / 8));
  const luminanceLevels = createLuminanceLevels(bitCount);

  return (pixels: Uint8ClampedArray) =>
    packGrayscaleFrameInto(
      pixels,
      width,
      height,
      bitCount,
      packed,
      luminanceLevels,
    );
}

export function packGrayscaleFrame(
  pixels: Uint8ClampedArray,
  width = DEFAULT_CAPTURE_SETTINGS.width,
  height = DEFAULT_CAPTURE_SETTINGS.height,
  grayscaleBits = DEFAULT_CAPTURE_SETTINGS.grayscaleBits,
): GrayscaleFrame {
  const { bitCount, pixelCount } = validateFrameShape(
    width,
    height,
    grayscaleBits,
  );
  const packed = new Uint8Array(Math.ceil((pixelCount * bitCount) / 8));
  return packGrayscaleFrameInto(
    pixels,
    width,
    height,
    bitCount,
    packed,
    createLuminanceLevels(bitCount),
  );
}

function packGrayscaleFrameInto(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  bitCount: number,
  packed: Uint8Array,
  luminanceLevels: Uint8Array,
): GrayscaleFrame {
  const pixelCount = width * height;

  if (pixels.length < pixelCount * 4) {
    throw new RangeError("Not enough RGBA pixels for grayscale frame");
  }

  let accumulator = 0;
  let accumulatorBits = 0;
  let packedIndex = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const rgbaIndex = pixelIndex * 4;
    const luminance =
      (pixels[rgbaIndex] * 54 +
        pixels[rgbaIndex + 1] * 183 +
        pixels[rgbaIndex + 2] * 19) >>
      8;
    accumulator =
      (accumulator << bitCount) | luminanceLevels[luminance];
    accumulatorBits += bitCount;

    if (accumulatorBits >= 8) {
      accumulatorBits -= 8;
      packed[packedIndex] = (accumulator >> accumulatorBits) & 0xff;
      packedIndex += 1;
      accumulator &= (1 << accumulatorBits) - 1;
    }
  }

  if (accumulatorBits > 0) {
    packed[packedIndex] = (accumulator << (8 - accumulatorBits)) & 0xff;
  }

  return {
    bits: bitCount,
    data: globalThis.btoa(String.fromCharCode(...packed)),
    height,
    width,
  };
}

export function unpackGrayscaleFrame(
  frame: GrayscaleFrame,
  reusableImage?: ImageData,
): ImageData {
  const { binary, bitCount, height, pixelCount, width } =
    validatePackedGrayscaleFrame(frame);
  const image =
    reusableImage?.width === width && reusableImage.height === height
      ? reusableImage
      : new ImageData(width, height);
  const grayscaleLevels = GRAYSCALE_LEVELS[bitCount - 1];
  let accumulator = 0;
  let accumulatorBits = 0;
  let byteIndex = 0;

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    while (accumulatorBits < bitCount) {
      accumulator = (accumulator << 8) | binary.charCodeAt(byteIndex);
      accumulatorBits += 8;
      byteIndex += 1;
    }

    accumulatorBits -= bitCount;
    const quantizedLevel =
      (accumulator >> accumulatorBits) & ((1 << bitCount) - 1);
    accumulator &= (1 << accumulatorBits) - 1;
    const value = grayscaleLevels[quantizedLevel];
    const rgbaIndex = pixelIndex * 4;

    image.data[rgbaIndex] = value;
    image.data[rgbaIndex + 1] = value;
    image.data[rgbaIndex + 2] = value;
    image.data[rgbaIndex + 3] = 255;
  }

  return image;
}

function createLuminanceLevels(bitCount: number) {
  const maximumLevel = (1 << bitCount) - 1;

  return Uint8Array.from({ length: 256 }, (_, luminance) =>
    Math.round((luminance / 255) * maximumLevel),
  );
}

function validateFrameShape(
  width: number,
  height: number,
  grayscaleBits: number,
) {
  const bitCount = Math.max(1, Math.min(5, Math.round(grayscaleBits)));

  if (
    !Number.isInteger(width) ||
    width <= 0 ||
    width > MAX_FRAME_WIDTH ||
    !Number.isInteger(height) ||
    height <= 0 ||
    height > MAX_FRAME_HEIGHT
  ) {
    throw new RangeError("Invalid grayscale frame dimensions");
  }

  return { bitCount, pixelCount: width * height };
}

function validatePackedGrayscaleFrame(frame: GrayscaleFrame) {
  const width = frame?.width;
  const height = frame?.height;
  const bitCount = frame?.bits ?? 4;
  const data = frame?.data;

  if (
    !Number.isInteger(width) ||
    width <= 0 ||
    width > MAX_FRAME_WIDTH ||
    !Number.isInteger(height) ||
    height <= 0 ||
    height > MAX_FRAME_HEIGHT
  ) {
    throw new RangeError("Invalid grayscale frame dimensions");
  }

  if (!Number.isInteger(bitCount) || bitCount < 1 || bitCount > 5) {
    throw new RangeError("Invalid grayscale frame bit depth");
  }

  if (typeof data !== "string") {
    throw new TypeError("Invalid grayscale frame data");
  }

  const pixelCount = width * height;
  const expectedByteLength = Math.ceil((pixelCount * bitCount) / 8);
  const expectedBase64Length = 4 * Math.ceil(expectedByteLength / 3);

  if (data.length !== expectedBase64Length) {
    throw new RangeError("Invalid grayscale frame payload length");
  }

  let binary: string;

  try {
    binary = globalThis.atob(data);
  } catch {
    throw new TypeError("Invalid grayscale frame Base64 data");
  }

  if (binary.length !== expectedByteLength) {
    throw new RangeError("Invalid decoded grayscale frame length");
  }

  return { binary, bitCount, height, pixelCount, width };
}

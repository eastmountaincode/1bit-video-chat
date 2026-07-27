import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPTURE_SETTINGS_LIMITS,
  DEFAULT_CAPTURE_SETTINGS,
  normalizeCaptureSettings,
} from "./capture-settings.ts";

test("uses fixed capture settings with a 15 fps maximum", () => {
  assert.equal(CAPTURE_SETTINGS_LIMITS.frameRate.max, 15);
  assert.deepEqual(
    normalizeCaptureSettings(DEFAULT_CAPTURE_SETTINGS),
    DEFAULT_CAPTURE_SETTINGS,
  );
});

test("normalizes only the fixed setting boundaries", () => {
  assert.deepEqual(
    normalizeCaptureSettings({
      frameRate: 20,
      grayscaleBits: 99,
      height: 999,
      width: 999,
    }),
    {
      frameRate: 15,
      grayscaleBits: 5,
      height: 162,
      width: 216,
    },
  );

  assert.deepEqual(
    normalizeCaptureSettings({
      frameRate: Number.NaN,
      grayscaleBits: Number.NaN,
      height: Number.NaN,
      width: Number.NaN,
    }),
    {
      frameRate: 1,
      grayscaleBits: 1,
      height: 6,
      width: 8,
    },
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPTURE_ROOM_BUDGETS,
  DEFAULT_CAPTURE_SETTINGS,
  estimateCaptureRoomLoad,
  getAdaptiveCaptureSettings,
  getPixelOverlayCellBudget,
  normalizeCaptureSettings,
} from "./capture-settings.ts";

test("keeps default image quality and applies the measured fan-out rate", () => {
  const effective = getAdaptiveCaptureSettings(
    DEFAULT_CAPTURE_SETTINGS,
    20,
  );

  assert.deepEqual(effective, {
    ...DEFAULT_CAPTURE_SETTINGS,
    frameRate: 10,
  });
  assertRoomLoadWithinBudgets(effective, 20);
});

test("scales extreme settings to the room budgets", () => {
  const effective = getAdaptiveCaptureSettings(
    {
      frameRate: 23,
      grayscaleBits: 5,
      height: 162,
      width: 216,
    },
    20,
  );

  assert.deepEqual(effective, {
    frameRate: 3,
    grayscaleBits: 5,
    height: 75,
    width: 100,
  });
  assertRoomLoadWithinBudgets(effective, 20);
});

test("preserves lower user choices and adapts beyond twenty people", () => {
  const low = {
    frameRate: 8,
    grayscaleBits: 2,
    height: 48,
    width: 64,
  };

  assert.deepEqual(getAdaptiveCaptureSettings(low, 20), low);

  const thirtyPersonDefault = getAdaptiveCaptureSettings(
    DEFAULT_CAPTURE_SETTINGS,
    30,
  );
  assert.deepEqual(thirtyPersonDefault, {
    frameRate: 4,
    grayscaleBits: 3,
    height: 60,
    width: 80,
  });
  assertRoomLoadWithinBudgets(thirtyPersonDefault, 30);
});

test("budgets chunked frames by messages and live pixel styles by DOM work", () => {
  const chunked = getAdaptiveCaptureSettings(
    {
      frameRate: 20,
      grayscaleBits: 5,
      height: 75,
      width: 100,
    },
    20,
  );
  assert.equal(chunked.frameRate, 3);
  assert.ok(
    estimateCaptureRoomLoad(chunked, 20).transportMessagesPerSecond <= 20,
  );

  const livePixels = getAdaptiveCaptureSettings(
    DEFAULT_CAPTURE_SETTINGS,
    20,
    { livePixelMetadata: true },
  );
  assert.deepEqual(livePixels, {
    frameRate: 10,
    grayscaleBits: 3,
    height: 12,
    width: 16,
  });
  assertRoomLoadWithinBudgets(livePixels, 20, true);
  assert.equal(getPixelOverlayCellBudget(20), 200);
  assert.ok(
    getPixelOverlayCellBudget(20) * 20 <=
      CAPTURE_ROOM_BUDGETS.pixelOverlayNodes,
  );
});

test("respects a lower server event-message rate", () => {
  assert.equal(
    getAdaptiveCaptureSettings(DEFAULT_CAPTURE_SETTINGS, 2, {
      serverMaxHz: 10,
    }).frameRate,
    10,
  );
});

test("keeps frame transport independent of UTF-8 identity names", () => {
  assert.equal(
    getAdaptiveCaptureSettings(DEFAULT_CAPTURE_SETTINGS, 20, {
      name: "界".repeat(24),
    }).frameRate,
    10,
  );
});

test("normalizes invalid and out-of-range capture settings", () => {
  assert.deepEqual(
    normalizeCaptureSettings({
      frameRate: Number.NaN,
      grayscaleBits: 99,
      height: -1,
      width: 999,
    }),
    {
      frameRate: 1,
      grayscaleBits: 5,
      height: 6,
      width: 216,
    },
  );
});

function assertRoomLoadWithinBudgets(
  settings: Parameters<typeof estimateCaptureRoomLoad>[0],
  participantCount: number,
  livePixelMetadata = false,
) {
  const load = estimateCaptureRoomLoad(settings, participantCount);

  assert.ok(
    load.totalPixelNodes <= CAPTURE_ROOM_BUDGETS.totalPixelNodes,
  );
  if (livePixelMetadata) {
    assert.ok(
      load.totalPixelNodes <= CAPTURE_ROOM_BUDGETS.pixelOverlayNodes,
    );
  }
  assert.ok(
    load.pixelUpdatesPerSecond <=
      (livePixelMetadata
        ? CAPTURE_ROOM_BUDGETS.livePixelUpdatesPerSecond
        : CAPTURE_ROOM_BUDGETS.pixelUpdatesPerSecond),
  );
  assert.ok(
    load.estimatedInboundBytesPerSecond <=
      CAPTURE_ROOM_BUDGETS.estimatedInboundBytesPerSecond,
  );
  assert.ok(load.transportMessagesPerSecond <= 20);
  assert.ok(
    load.roomMessageDeliveriesPerSecond <=
      CAPTURE_ROOM_BUDGETS.roomMessageDeliveriesPerSecond,
  );
}

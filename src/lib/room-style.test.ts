import assert from "node:assert/strict";
import test from "node:test";

import {
  roomStyleUsesLivePixelMetadata,
  roomStyleUsesVideoPixelOverlay,
} from "./room-style.ts";

test("detects room styles that need changing pixel-level metadata", () => {
  assert.equal(
    roomStyleUsesLivePixelMetadata(`
      [data-room-part="video-pixel"] {
        border: 1px solid red;
      }
    `),
    false,
  );
  assert.equal(
    roomStyleUsesLivePixelMetadata(`
      [data-pixel-level="3"] { background: red; }
    `),
    true,
  );
  assert.equal(
    roomStyleUsesLivePixelMetadata(`
      [data-room-part="video-pixel"] {
        opacity: calc(var(--pixel-level) / 7);
      }
    `),
    true,
  );
  assert.equal(
    roomStyleUsesLivePixelMetadata(`
      [data-room-part="video-pixel"] { opacity: 0.5; }
    `),
    true,
  );
  assert.equal(
    roomStyleUsesLivePixelMetadata(`
      [data-room-part="sidebar"] { opacity: 0.5; }
    `),
    false,
  );
  assert.equal(
    roomStyleUsesLivePixelMetadata(`
      [data-room-part="video-pixel"] {
        animation: blink 1s infinite;
        scale: 0.8;
      }
    `),
    true,
  );
});

test("mounts the pixel overlay only for actual pixel styling", () => {
  assert.equal(
    roomStyleUsesVideoPixelOverlay(`
      [data-room-part="video-pixel"] {
        /* intentionally empty */
      }
    `),
    false,
  );
  assert.equal(
    roomStyleUsesVideoPixelOverlay(`
      [data-room-part="video-pixel"] { color: red; }
    `),
    true,
  );
  assert.equal(
    roomStyleUsesVideoPixelOverlay(`
      [data-pixel-x="2"] { border: 1px solid red; }
    `),
    true,
  );
  assert.equal(
    roomStyleUsesVideoPixelOverlay(`
      [data-room-part=video-pixel] { border: 1px solid red; }
    `),
    true,
  );
});

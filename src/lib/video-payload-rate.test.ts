import assert from "node:assert/strict";
import test from "node:test";

import {
  measureVideoPayloadBytes,
  recordVideoPayloadSample,
} from "./video-payload-rate.ts";

test("measures only the independently observable encoded frame bytes", () => {
  assert.equal(
    measureVideoPayloadBytes({
      bits: 3,
      data: "AAAA/w==",
      height: 1,
      width: 8,
    }),
    8,
  );
});

test("keeps only samples inside the rolling payload window", () => {
  const first = recordVideoPayloadSample([], 100, 1_000);
  const second = recordVideoPayloadSample(first.samples, 900, 2_000);
  const third = recordVideoPayloadSample(second.samples, 1_101, 3_000);

  assert.equal(second.bytesPerSecond, 3_000);
  assert.equal(third.bytesPerSecond, 5_000);
  assert.deepEqual(
    third.samples.map((sample) => sample.at),
    [900, 1_101],
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  getCreatedRoomDeadline,
  getHeartbeatRoomDeadline,
  isRoomDeadlineActive,
  renewRoomDeadline,
  ROOM_EMPTY_GRACE_MS,
  ROOM_HEARTBEAT_DEADLINE_MS,
  ROOM_HEARTBEAT_INTERVAL_MS,
} from "./room-lifecycle.ts";

test("keeps an unjoined room for exactly the two-minute grace period", () => {
  const createdAt = 10_000;
  const deadline = getCreatedRoomDeadline(createdAt);

  assert.equal(deadline, createdAt + 120_000);
  assert.equal(isRoomDeadlineActive(deadline, deadline - 1), true);
  assert.equal(isRoomDeadlineActive(deadline, deadline), false);
});

test("heartbeat timing leaves at least two minutes after an abrupt close", () => {
  const heartbeatAt = 50_000;
  const deadline = getHeartbeatRoomDeadline(heartbeatAt);
  const latestPossibleClose = heartbeatAt + ROOM_HEARTBEAT_INTERVAL_MS;

  assert.equal(
    deadline - latestPossibleClose,
    ROOM_EMPTY_GRACE_MS,
  );
  assert.equal(
    deadline - heartbeatAt,
    ROOM_HEARTBEAT_DEADLINE_MS,
  );
});

test("a stale heartbeat cannot shorten a newer room deadline", () => {
  const first = renewRoomDeadline(200_000, 100_000);
  assert.equal(first, 240_000);

  const delayedOlderRequest = renewRoomDeadline(first, 90_000);
  assert.equal(delayedOlderRequest, first);
});

test("an expired room cannot be revived by a late heartbeat", () => {
  assert.equal(renewRoomDeadline(100_000, 100_000), null);
  assert.equal(renewRoomDeadline(99_999, 100_000), null);
});

test("one of twenty active clients keeps the shared room alive", () => {
  let deadline = getCreatedRoomDeadline(0);

  for (let round = 0; round < 12; round += 1) {
    const now = round * ROOM_HEARTBEAT_INTERVAL_MS;
    for (let client = 0; client < 20; client += 1) {
      const renewed = renewRoomDeadline(deadline, now);
      assert.notEqual(renewed, null);
      deadline = renewed!;
    }
  }

  const lastHeartbeat = 11 * ROOM_HEARTBEAT_INTERVAL_MS;
  assert.equal(
    deadline,
    lastHeartbeat + ROOM_HEARTBEAT_DEADLINE_MS,
  );
  assert.equal(isRoomDeadlineActive(deadline, deadline - 1), true);
  assert.equal(isRoomDeadlineActive(deadline, deadline), false);
});

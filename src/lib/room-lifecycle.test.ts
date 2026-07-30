import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getCreatedRoomDeadline,
  getHeartbeatRoomDeadline,
  isValidRoomParticipantId,
  isRoomDeadlineActive,
  renewRoomDeadline,
  ROOM_EMPTY_GRACE_MS,
  ROOM_EXPIRY_ENABLED,
  ROOM_HEARTBEAT_DEADLINE_MS,
  ROOM_HEARTBEAT_INTERVAL_MS,
  ROOM_PARTICIPANT_LEASE_MS,
} from "./room-lifecycle.ts";

const roomRegistrySource = readFileSync(
  new URL("./redis-room-registry.ts", import.meta.url),
  "utf8",
);

test("keeps the two-minute deadline policy ready while deletion is disabled", () => {
  const createdAt = 10_000;
  const deadline = getCreatedRoomDeadline(createdAt);

  assert.equal(ROOM_EXPIRY_ENABLED, false);
  assert.equal(deadline, createdAt + 120_000);
  assert.equal(isRoomDeadlineActive(deadline, deadline - 1), true);
  assert.equal(isRoomDeadlineActive(deadline, deadline), false);
});

test("guards every automatic room-deletion path with the one expiry switch", () => {
  assert.match(
    roomRegistrySource,
    /const ROOM_EXPIRY_ENABLED_LUA = ROOM_EXPIRY_ENABLED \? "true" : "false";/,
  );
  assert.equal(
    roomRegistrySource.match(
      /local roomExpiryEnabled = \$\{ROOM_EXPIRY_ENABLED_LUA\}/g,
    )?.length,
    5,
  );
  assert.equal(
    roomRegistrySource.match(/if roomExpiryEnabled then/g)?.length,
    2,
  );
  assert.equal(
    roomRegistrySource.match(
      /\(roomExpiryEnabled and tonumber\(deadline\) <= now\)/g,
    )?.length,
    3,
  );
  assert.match(
    roomRegistrySource,
    /redis\.call\("ZADD", KEYS\[1\], "XX", now \+ tonumber\(ARGV\[3\]\), ARGV\[1\]\)/,
  );
  assert.equal(
    roomRegistrySource.match(
      /redis\.call\("ZREMRANGEBYSCORE", KEYS\[3\], "-inf", now\)/g,
    )?.length,
    3,
  );
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

test("the retained deadline policy rejects a late heartbeat", () => {
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

test("participant leases outlast the heartbeat interval", () => {
  assert.ok(ROOM_PARTICIPANT_LEASE_MS > ROOM_HEARTBEAT_INTERVAL_MS);
  assert.equal(isValidRoomParticipantId("a".repeat(32)), true);
  assert.equal(isValidRoomParticipantId("A".repeat(32)), false);
  assert.equal(isValidRoomParticipantId("a".repeat(31)), false);
});

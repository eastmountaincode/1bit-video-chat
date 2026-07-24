import assert from "node:assert/strict";
import test from "node:test";

import {
  createPublicRoom,
  getPlayHtmlRoomForPath,
  getPublicRooms,
  getRoomHref,
  isValidRoomId,
  MAIN_ROOM,
  MAX_PUBLIC_ROOMS,
  normalizeRoomName,
  parsePublicRoom,
  PLAYHTML_LEGACY_MAIN_ROOM,
  PLAYHTML_LOBBY_ROOM,
} from "./room-directory.ts";

test("normalizes public room names without allowing controls or unbounded text", () => {
  assert.equal(normalizeRoomName("  Friday\n  meeting  "), "Friday meeting");
  assert.equal(normalizeRoomName("safe\u202Ename"), "safename");
  assert.equal(normalizeRoomName("Ａ room"), "A room");
  assert.equal(Array.from(normalizeRoomName("x".repeat(80))).length, 48);
  assert.equal(normalizeRoomName(null), "");
});

test("creates bounded URL-safe room IDs with collision-resistant suffixes", () => {
  const room = createPublicRoom(
    " Design critique! ",
    "a71d90f4-2c8b-4fff-8000-000000000000",
    1_000,
  );

  assert.deepEqual(room, {
    createdAt: 1_000,
    id: "design-critique-a71d90f42c8b",
    name: "Design critique!",
  });
  assert.equal(createPublicRoom("   ", "a".repeat(12), 1_000), null);
  assert.equal(createPublicRoom("room", "not-enough", 1_000), null);
  assert.equal(isValidRoomId(room?.id), true);
});

test("accepts only strict single-segment room IDs", () => {
  assert.equal(isValidRoomId("main"), true);
  assert.equal(isValidRoomId("design-chat-a71d90f42c8b"), true);
  assert.equal(isValidRoomId("../main"), false);
  assert.equal(isValidRoomId("room/name"), false);
  assert.equal(isValidRoomId("Room"), false);
  assert.equal(isValidRoomId(`r${"x".repeat(64)}`), false);
});

test("sanitizes, sorts, deduplicates, and caps the server room list", () => {
  const now = 10_000;
  const rooms: unknown[] = [
    { ...MAIN_ROOM, name: "spoofed" },
    { createdAt: 1_000, id: "older", name: "Older" },
    { createdAt: 9_000, id: "newest", name: "Newest" },
    { createdAt: 8_000, id: "another-id", name: "Mismatch" },
    { createdAt: 7_000, id: "invalid", name: "Bad\nname" },
  ];

  for (let index = 0; index < MAX_PUBLIC_ROOMS + 20; index += 1) {
    const id = `room-${String(index).padStart(3, "0")}`;
    rooms.push({ createdAt: 2_000 + index, id, name: `Room ${index}` });
  }

  const visible = getPublicRooms(rooms, now);
  assert.equal(visible[0], MAIN_ROOM);
  assert.equal(visible[1].id, "newest");
  assert.equal(visible.some((room) => room.id === "invalid"), false);
  assert.equal(visible.length, MAX_PUBLIC_ROOMS);
});

test("accepts only complete server room records", () => {
  assert.deepEqual(
    parsePublicRoom({ createdAt: 1_000, id: "first", name: "First" }, 2_000),
    { createdAt: 1_000, id: "first", name: "First" },
  );
  assert.equal(
    parsePublicRoom({ createdAt: 1_000, id: "first", name: " First " }, 2_000),
    null,
  );
  assert.equal(parsePublicRoom({ id: "first", name: "First" }, 2_000), null);
});

test("maps the lobby and every camera route to isolated PlayHTML rooms", () => {
  assert.equal(getPlayHtmlRoomForPath("/"), PLAYHTML_LOBBY_ROOM);
  assert.equal(getPlayHtmlRoomForPath("/rooms/main"), PLAYHTML_LEGACY_MAIN_ROOM);
  assert.equal(
    getPlayHtmlRoomForPath("/rooms/design-a71d90f42c8b"),
    "one-bit-video-chat:room:design-a71d90f42c8b:v1",
  );
  assert.notEqual(
    getPlayHtmlRoomForPath("/rooms/first-111111111111"),
    getPlayHtmlRoomForPath("/rooms/second-222222222222"),
  );
  assert.equal(
    getPlayHtmlRoomForPath("/rooms/..%2Fmain"),
    "one-bit-video-chat:invalid-route:v1",
  );
});

test("room links no longer trust a name supplied in the URL", () => {
  assert.equal(getRoomHref(MAIN_ROOM), "/rooms/main");
  assert.equal(
    getRoomHref({
      createdAt: 1_000,
      id: "design-chat-a71d90f42c8b",
      name: "Design chat",
    }),
    "/rooms/design-chat-a71d90f42c8b",
  );
});

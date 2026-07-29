import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  clampRoomSidebarWidth,
  getDraggedRoomSidebarWidth,
  getRoomResizeBounds,
} from "./room-resize.ts";
import { ROOM_STYLE_SCAFFOLD } from "./room-style.ts";

const globalCss = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const resizeHandle = readFileSync(
  new URL("../components/room-resize-handle.tsx", import.meta.url),
  "utf8",
);
const videoRoom = readFileSync(
  new URL("../components/video-room.tsx", import.meta.url),
  "utf8",
);

test("room resize bounds preserve usable video and sidebar widths", () => {
  assert.deepEqual(getRoomResizeBounds(1_200, 16), {
    maxWidth: 879,
    minWidth: 288,
  });
  assert.deepEqual(getRoomResizeBounds(500, 16), {
    maxWidth: 288,
    minWidth: 288,
  });
});

test("dragging left widens the sidebar and clamps at both bounds", () => {
  const bounds = { maxWidth: 600, minWidth: 288 };

  assert.equal(
    getDraggedRoomSidebarWidth(400, 800, 700, bounds),
    500,
  );
  assert.equal(
    getDraggedRoomSidebarWidth(400, 800, 1_000, bounds),
    288,
  );
  assert.equal(
    getDraggedRoomSidebarWidth(400, 800, 500, bounds),
    600,
  );
  assert.equal(clampRoomSidebarWidth(450, bounds), 450);
});

test("the plain draggable separator sits between video and sidebar", () => {
  const videoIndex = videoRoom.indexOf('id="room-video-area"');
  const handleIndex = videoRoom.indexOf("<RoomResizeHandle");
  const sidebarIndex = videoRoom.indexOf("<RoomSidebar");

  assert.ok(videoIndex >= 0);
  assert.ok(handleIndex > videoIndex);
  assert.ok(sidebarIndex > handleIndex);
  assert.match(resizeHandle, /role="separator"/);
  assert.match(resizeHandle, /aria-orientation="vertical"/);
  assert.doesNotMatch(resizeHandle, /onDoubleClick=/);
  assert.doesNotMatch(resizeHandle, /onKeyDown=/);
  assert.doesNotMatch(resizeHandle, /tabIndex=/);
  assert.doesNotMatch(resizeHandle, /title=/);
  assert.match(ROOM_STYLE_SCAFFOLD, /\[data-room-part="divider"\]/);
});

test("the divider is one visible pixel with an undecorated grab area", () => {
  assert.match(
    globalCss,
    /\.room-shell\s*\{[^}]*grid-template-columns:\s*minmax\(20rem, 1fr\)\s*1px\s*minmax\(/s,
  );
  assert.match(
    globalCss,
    /\.room-resize-handle\s*\{[^}]*cursor:\s*col-resize;[^}]*margin-inline:\s*-6px;[^}]*touch-action:\s*none;[^}]*width:\s*13px;/s,
  );
  assert.doesNotMatch(globalCss, /\.room-resize-handle::after/);
  assert.doesNotMatch(globalCss, /\.room-resize-handle:focus-visible/);
  assert.match(
    globalCss,
    /@media \(max-width: 720px\)[\s\S]*?\.room-resize-handle\s*\{[^}]*display:\s*none;/,
  );
});

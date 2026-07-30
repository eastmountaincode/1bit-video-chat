import assert from "node:assert/strict";
import test from "node:test";

import { syncedStore } from "@syncedstore/core";
import * as Y from "yjs";

import {
  createRoomStrudelRuntimeSnapshot,
  DEFAULT_ROOM_STRUDEL_RUNTIME,
  MAX_STRUDEL_CODE_LENGTH,
  MAX_STRUDEL_RUNTIME_COMMAND_ID_LENGTH,
  MAX_STRUDEL_RUNTIME_REQUESTED_BY_LENGTH,
  normalizeRoomStrudelRuntimeData,
  type RoomStrudelRuntimeData,
  type RoomStrudelRuntimeSnapshot,
} from "./room-strudel.ts";

test("normalizes a valid shared Strudel runtime snapshot", () => {
  const snapshot = createRoomStrudelRuntimeSnapshot({
    commandId: "run-one",
    enabled: true,
    code: 'sound("bd sd")',
    requestedAt: 12,
    requestedBy: "andrew",
  });

  assert.deepEqual(
    normalizeRoomStrudelRuntimeData({
      current: snapshot,
      version: 1,
    }),
    {
      current: snapshot,
      version: 1,
    },
  );
});

test("normalizes malformed or incomplete runtime snapshots to disabled", () => {
  const malformedValues = [
    null,
    {},
    { current: null, version: 2 },
    { current: {}, version: 1 },
    {
      current: {
        enabled: true,
        code: 'sound("bd")',
        requestedAt: 1,
        requestedBy: "andrew",
      },
      version: 1,
    },
    {
      current: {
        commandId: "",
        enabled: true,
        code: 'sound("bd")',
        requestedAt: 1,
        requestedBy: "andrew",
      },
      version: 1,
    },
    {
      current: {
        commandId:
          " ".repeat(MAX_STRUDEL_RUNTIME_COMMAND_ID_LENGTH) + "x",
        enabled: true,
        code: 'sound("bd")',
        requestedAt: 1,
        requestedBy: "andrew",
      },
      version: 1,
    },
    {
      current: {
        commandId: "run",
        enabled: true,
        code: "",
        requestedAt: 1,
        requestedBy: "andrew",
      },
      version: 1,
    },
    {
      current: {
        commandId: "run",
        enabled: true,
        code: 'sound("bd")',
        requestedAt: Number.NaN,
        requestedBy: "andrew",
      },
      version: 1,
    },
  ];

  for (const value of malformedValues) {
    assert.deepEqual(
      normalizeRoomStrudelRuntimeData(value),
      DEFAULT_ROOM_STRUDEL_RUNTIME,
    );
  }
});

test("caps shared Strudel runtime code, requester name, and command id", () => {
  const normalized = normalizeRoomStrudelRuntimeData({
    current: {
      commandId: "i".repeat(MAX_STRUDEL_RUNTIME_COMMAND_ID_LENGTH + 10),
      enabled: true,
      code: "x".repeat(MAX_STRUDEL_CODE_LENGTH + 10),
      requestedAt: 1,
      requestedBy: "n".repeat(
        MAX_STRUDEL_RUNTIME_REQUESTED_BY_LENGTH + 10,
      ),
    },
    version: 1,
  });

  assert.equal(
    normalized.current?.commandId.length,
    MAX_STRUDEL_RUNTIME_COMMAND_ID_LENGTH,
  );
  assert.equal(normalized.current?.code.length, MAX_STRUDEL_CODE_LENGTH);
  assert.equal(
    normalized.current?.requestedBy.length,
    MAX_STRUDEL_RUNTIME_REQUESTED_BY_LENGTH,
  );
});

test("same-code requests remain distinct when callers supply fresh ids", () => {
  const input = {
    enabled: true,
    code: 'sound("bd")',
    requestedAt: 1,
    requestedBy: "andrew",
  };
  const first = createRoomStrudelRuntimeSnapshot({
    ...input,
    commandId: "run-one",
  });
  const second = createRoomStrudelRuntimeSnapshot({
    ...input,
    commandId: "run-two",
  });

  assert.equal(first.code, second.code);
  assert.notEqual(first.commandId, second.commandId);
});

test("a stop remains a complete snapshot and preserves supplied code", () => {
  const snapshot = createRoomStrudelRuntimeSnapshot({
    commandId: "stop-one",
    enabled: false,
    code: 'sound("hh*4")',
    requestedAt: 20,
    requestedBy: "andrew",
  });

  assert.deepEqual(snapshot, {
    commandId: "stop-one",
    enabled: false,
    code: 'sound("hh*4")',
    requestedAt: 20,
    requestedBy: "andrew",
  });
});

test("concurrent runtime replacements converge to one whole snapshot", () => {
  const seed = makeRuntimeStore();
  seed.runtime.current = null;
  seed.runtime.version = 1;
  const seedUpdate = Y.encodeStateAsUpdate(seed.doc);
  const first = makeRuntimeStore();
  const second = makeRuntimeStore();
  Y.applyUpdate(first.doc, seedUpdate);
  Y.applyUpdate(second.doc, seedUpdate);

  const run = createRoomStrudelRuntimeSnapshot({
    commandId: "run-command",
    enabled: true,
    code: 'sound("bd")',
    requestedAt: 30,
    requestedBy: "run-user",
  });
  const stop = createRoomStrudelRuntimeSnapshot({
    commandId: "stop-command",
    enabled: false,
    code: 'sound("hh")',
    requestedAt: 31,
    requestedBy: "stop-user",
  });
  first.runtime.current = run;
  second.runtime.current = stop;

  const firstUpdate = Y.encodeStateAsUpdate(first.doc);
  const secondUpdate = Y.encodeStateAsUpdate(second.doc);
  Y.applyUpdate(first.doc, secondUpdate);
  Y.applyUpdate(second.doc, firstUpdate);

  const firstResult = normalizeRoomStrudelRuntimeData(first.runtime);
  const secondResult = normalizeRoomStrudelRuntimeData(second.runtime);
  assert.deepEqual(firstResult, secondResult);
  assert.ok(firstResult.current);
  assert.equal(
    isSameSnapshot(firstResult.current, run) ||
      isSameSnapshot(firstResult.current, stop),
    true,
  );
});

function makeRuntimeStore() {
  const doc = new Y.Doc();
  const store = syncedStore({ runtime: {} }, doc) as unknown as {
    runtime: RoomStrudelRuntimeData;
  };

  return { doc, runtime: store.runtime };
}

function isSameSnapshot(
  actual: RoomStrudelRuntimeSnapshot,
  expected: RoomStrudelRuntimeSnapshot,
) {
  return (
    actual.commandId === expected.commandId &&
    actual.enabled === expected.enabled &&
    actual.code === expected.code &&
    actual.requestedAt === expected.requestedAt &&
    actual.requestedBy === expected.requestedBy
  );
}

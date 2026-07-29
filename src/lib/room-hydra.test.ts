import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { syncedStore } from "@syncedstore/core";
import * as Y from "yjs";

import { HYDRA_FRAME_DOCUMENT } from "./hydra-frame-document.ts";
import {
  createRoomHydraDocument,
  createHydraRevision,
  DEFAULT_COLLABORATIVE_ROOM_HYDRA,
  DEFAULT_HYDRA_CODE,
  getCollaborativeRoomHydraCode,
  isHydraFrameCommand,
  isHydraFrameEvent,
  MAX_HYDRA_CODE_LENGTH,
  normalizeRoomHydraData,
  type CollaborativeRoomHydraData,
  type RoomHydraData,
} from "./room-hydra.ts";
import {
  createTextEntries,
  mergeTextEntrySplices,
  readTextEntries,
} from "./shared-text-entries.ts";

const hydraBackground = readFileSync(
  new URL("../components/hydra-background.tsx", import.meta.url),
  "utf8",
);
const hydraPanel = readFileSync(
  new URL("../components/hydra-panel.tsx", import.meta.url),
  "utf8",
);
const collaborativeCodeEditor = readFileSync(
  new URL("../hooks/use-collaborative-code-editor.ts", import.meta.url),
  "utf8",
);

test("normalizes malformed shared Hydra state safely", () => {
  const normalized = normalizeRoomHydraData({
    code: "",
    enabled: true,
    updatedAt: Number.NaN,
    updatedBy: 42,
    version: 1,
  } as unknown as RoomHydraData);

  assert.equal(normalized.code, DEFAULT_HYDRA_CODE);
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.updatedAt, 0);
  assert.equal(normalized.updatedBy, "");
});

test("caps shared Hydra code", () => {
  const normalized = normalizeRoomHydraData({
    code: "x".repeat(MAX_HYDRA_CODE_LENGTH + 10),
    enabled: false,
    updatedAt: 1,
    updatedBy: "andrew",
    version: 1,
  });

  assert.equal(normalized.code.length, MAX_HYDRA_CODE_LENGTH);
});

test("creates a bounded collaborative Hydra draft", () => {
  const document = createRoomHydraDocument(
    "x".repeat(MAX_HYDRA_CODE_LENGTH + 10),
    "hydra-document",
    12,
  );

  assert.equal(document.entries.length, MAX_HYDRA_CODE_LENGTH);
  assert.equal(
    getCollaborativeRoomHydraCode(
      {
        ...DEFAULT_COLLABORATIVE_ROOM_HYDRA,
        current: document,
      },
      DEFAULT_HYDRA_CODE,
    ).length,
    MAX_HYDRA_CODE_LENGTH,
  );
});

test("falls back from a malformed collaborative Hydra draft", () => {
  assert.equal(
    getCollaborativeRoomHydraCode(
      {
        ...DEFAULT_COLLABORATIVE_ROOM_HYDRA,
        current: {
          createdAt: 0,
          entries: ["malformed"],
          id: "broken",
        },
      },
      DEFAULT_HYDRA_CODE,
    ),
    DEFAULT_HYDRA_CODE,
  );
});

test("merges stale edits to the same Hydra draft", () => {
  const base = createRoomHydraDocument(
    "osc().out()",
    "base",
    0,
  ).entries;
  const first = mergeTextEntrySplices(
    base,
    base,
    [{ index: 0, deleteCount: 0, insert: "// one\n" }],
    { start: 7, end: 7 },
    () => "one",
    MAX_HYDRA_CODE_LENGTH,
  );
  const second = mergeTextEntrySplices(
    base,
    first.entries,
    [
      {
        index: base.length,
        deleteCount: 0,
        insert: "\n// two",
      },
    ],
    { start: base.length + 7, end: base.length + 7 },
    () => "two",
    MAX_HYDRA_CODE_LENGTH,
  );
  const mergedCode = readTextEntries(second.entries);

  assert.match(mergedCode, /\/\/ one/);
  assert.match(mergedCode, /osc\(\)\.out\(\)/);
  assert.match(mergedCode, /\/\/ two/);
});

test("20 concurrent Hydra editors converge without losing insertions", () => {
  const seed = makeHydraStore();
  const initialCode = "osc().out()";
  seed.hydra.current = createRoomHydraDocument(
    initialCode,
    "seed",
    0,
  );
  seed.hydra.updatedAt = 0;
  seed.hydra.updatedBy = "";
  seed.hydra.version = 1;
  const seedUpdate = Y.encodeStateAsUpdate(seed.doc);
  const clients = Array.from({ length: 20 }, (_, index) => {
    const client = makeHydraStore();
    Y.applyUpdate(client.doc, seedUpdate);
    const marker = `\n// user-${index.toString().padStart(2, "0")}`;
    client.hydra.current?.entries.splice(
      initialCode.length,
      0,
      ...createTextEntries(marker, `user-${index}`),
    );
    return client;
  });
  const updates = clients.map((client) =>
    Y.encodeStateAsUpdate(client.doc),
  );

  for (const target of clients) {
    for (const update of updates) {
      Y.applyUpdate(target.doc, update);
    }
  }

  const convergedCodes = new Set(
    clients.map((client) =>
      getCollaborativeRoomHydraCode(client.hydra, ""),
    ),
  );
  assert.equal(convergedCodes.size, 1);

  const [code] = convergedCodes;
  assert.match(code, /osc\(\)\.out\(\)/);
  for (let index = 0; index < 20; index += 1) {
    assert.match(
      code,
      new RegExp(`// user-${index.toString().padStart(2, "0")}`),
    );
  }
});

test("creates stable revisions that change with the sketch", () => {
  assert.equal(
    createHydraRevision("osc().out()", 12),
    createHydraRevision("osc().out()", 12),
  );
  assert.notEqual(
    createHydraRevision("osc().out()", 12),
    createHydraRevision("noise().out()", 12),
  );
});

test("validates the Hydra frame message boundary", () => {
  assert.equal(
    isHydraFrameCommand({
      code: "osc().out()",
      revision: "1:11:test",
      source: "telepathy-hydra",
      type: "run",
    }),
    true,
  );
  assert.equal(
    isHydraFrameCommand({
      code: "x".repeat(MAX_HYDRA_CODE_LENGTH + 1),
      revision: "too-long",
      source: "telepathy-hydra",
      type: "run",
    }),
    false,
  );
  assert.equal(
    isHydraFrameEvent({
      source: "telepathy-hydra",
      type: "ready",
    }),
    true,
  );
  assert.equal(
    isHydraFrameEvent({
      error: "bad sketch",
      ok: false,
      revision: "1",
      source: "telepathy-hydra",
      type: "result",
    }),
    true,
  );
});

test("keeps shared Hydra code inside an origin-isolated frame", () => {
  assert.match(hydraBackground, /sandbox="allow-scripts"/);
  assert.doesNotMatch(hydraBackground, /allow-same-origin/);
  assert.match(
    HYDRA_FRAME_DOCUMENT,
    /<script src="\/hydra-synth-1\.4\.0\.js"><\/script>/,
  );
  assert.match(HYDRA_FRAME_DOCUMENT, /event\.source !== window\.parent/);
  assert.match(HYDRA_FRAME_DOCUMENT, /hydra\.eval\(command\.code\)/);
});

test("does not add a transient loading row to the Hydra editor", () => {
  assert.doesNotMatch(hydraPanel, /hydra loading/i);
});

test("uses minimal controls that become update and stop while running", () => {
  assert.match(hydraPanel, />\s*stop\s*<\/button>/);
  assert.match(
    hydraPanel,
    /\{hydra\.enabled \? "update" : "run"\}/,
  );
  assert.doesNotMatch(
    hydraPanel,
    />\s*(?:run|stop) hydra\s*</i,
  );
});

test("backs the Hydra editor with the shared character document", () => {
  assert.match(hydraPanel, /room-hydra-code:v1/);
  assert.match(hydraPanel, /onRunShortcut:\s*onRun/);
  assert.match(collaborativeCodeEditor, /mergeTextEntrySplices/);
});

function makeHydraStore() {
  const doc = new Y.Doc();
  const store = syncedStore({ hydra: {} }, doc) as unknown as {
    hydra: CollaborativeRoomHydraData;
  };

  return { doc, hydra: store.hydra };
}

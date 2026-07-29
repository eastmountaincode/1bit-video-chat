import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { syncedStore } from "@syncedstore/core";
import * as Y from "yjs";

import {
  createRoomStrudelDocument,
  createStrudelRevision,
  DEFAULT_COLLABORATIVE_ROOM_STRUDEL,
  DEFAULT_STRUDEL_CODE,
  getCollaborativeRoomStrudelCode,
  isStrudelFrameCommand,
  isStrudelFrameEvent,
  MAX_STRUDEL_CODE_LENGTH,
  type CollaborativeRoomStrudelData,
} from "./room-strudel.ts";
import {
  createTextEntries,
  readTextEntries,
} from "./shared-text-entries.ts";
import { STRUDEL_FRAME_DOCUMENT } from "./strudel-frame-document.ts";

const strudelPanel = readFileSync(
  new URL("../components/strudel-panel.tsx", import.meta.url),
  "utf8",
);
const strudelControls = readFileSync(
  new URL("../components/strudel-runtime-controls.tsx", import.meta.url),
  "utf8",
);
const collaborativeCodeEditor = readFileSync(
  new URL("../hooks/use-collaborative-code-editor.ts", import.meta.url),
  "utf8",
);

test("creates and reads a bounded collaborative Strudel score", () => {
  const document = createRoomStrudelDocument(
    "x".repeat(MAX_STRUDEL_CODE_LENGTH + 10),
    "strudel-document",
    12,
  );

  assert.equal(document.entries.length, MAX_STRUDEL_CODE_LENGTH);
  assert.equal(
    getCollaborativeRoomStrudelCode(
      {
        ...DEFAULT_COLLABORATIVE_ROOM_STRUDEL,
        current: document,
      },
      DEFAULT_STRUDEL_CODE,
    ).length,
    MAX_STRUDEL_CODE_LENGTH,
  );
});

test("falls back from a malformed collaborative Strudel score", () => {
  assert.equal(
    getCollaborativeRoomStrudelCode(
      {
        ...DEFAULT_COLLABORATIVE_ROOM_STRUDEL,
        current: {
          createdAt: 0,
          entries: ["malformed"],
          id: "broken",
        },
      },
      DEFAULT_STRUDEL_CODE,
    ),
    DEFAULT_STRUDEL_CODE,
  );
});

test("20 concurrent Strudel editors converge without losing insertions", () => {
  const seed = makeStrudelStore();
  const initialCode = 'note("c3").s("sine")';
  seed.strudel.current = createRoomStrudelDocument(
    initialCode,
    "seed",
    0,
  );
  seed.strudel.updatedAt = 0;
  seed.strudel.updatedBy = "";
  seed.strudel.version = 1;
  const seedUpdate = Y.encodeStateAsUpdate(seed.doc);
  const clients = Array.from({ length: 20 }, (_, index) => {
    const client = makeStrudelStore();
    Y.applyUpdate(client.doc, seedUpdate);
    const marker = `\n// voice-${index.toString().padStart(2, "0")}`;
    client.strudel.current?.entries.splice(
      initialCode.length,
      0,
      ...createTextEntries(marker, `voice-${index}`),
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
      getCollaborativeRoomStrudelCode(client.strudel, ""),
    ),
  );
  assert.equal(convergedCodes.size, 1);

  const [code] = convergedCodes;
  assert.match(code, /note\("c3"\)/);
  for (let index = 0; index < 20; index += 1) {
    assert.match(
      code,
      new RegExp(`// voice-${index.toString().padStart(2, "0")}`),
    );
  }
  assert.equal(
    readTextEntries(clients[0].strudel.current?.entries ?? []),
    code,
  );
});

test("creates stable Strudel revisions that change with the score", () => {
  assert.equal(
    createStrudelRevision('note("c3")'),
    createStrudelRevision('note("c3")'),
  );
  assert.notEqual(
    createStrudelRevision('note("c3")'),
    createStrudelRevision('note("d3")'),
  );
});

test("validates the Strudel frame message boundary", () => {
  assert.equal(
    isStrudelFrameCommand({
      canRun: true,
      code: 'note("c3")',
      disabled: false,
      revision: "revision",
      source: "telepathy-strudel",
      type: "stage",
    }),
    true,
  );
  assert.equal(
    isStrudelFrameCommand({
      canRun: true,
      code: "x".repeat(MAX_STRUDEL_CODE_LENGTH + 1),
      disabled: false,
      revision: "too-long",
      source: "telepathy-strudel",
      type: "stage",
    }),
    false,
  );
  assert.equal(
    isStrudelFrameEvent({
      source: "telepathy-strudel",
      type: "ready",
    }),
    true,
  );
  assert.equal(
    isStrudelFrameEvent({
      error: "bad pattern",
      ok: false,
      revision: "revision",
      source: "telepathy-strudel",
      type: "result",
    }),
    true,
  );
});

test("keeps Strudel evaluation in a gesture-owning isolated frame", () => {
  assert.match(strudelControls, /allow="autoplay"/);
  assert.match(strudelControls, /sandbox="allow-scripts"/);
  assert.doesNotMatch(strudelControls, /allow-same-origin/);
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /<script src="\/strudel-web-1\.3\.0\/index\.js"><\/script>/,
  );
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /runButton\.addEventListener\("click"/,
  );
  assert.match(STRUDEL_FRAME_DOCUMENT, /await api\.initAudio\(\)/);
  assert.match(STRUDEL_FRAME_DOCUMENT, /await api\.evaluate\(code\)/);
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /api\.samples\("github:tidalcycles\/dirt-samples"\)/,
  );
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /event\.source !== window\.parent/,
  );
});

test("preloads the sample map used by standard Strudel drum names", () => {
  assert.match(STRUDEL_FRAME_DOCUMENT, /typeof api\.samples !== "function"/);
  assert.match(STRUDEL_FRAME_DOCUMENT, /prebake:/);
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /github:tidalcycles\/dirt-samples/,
  );
});

test("backs Strudel with the shared editor and no loading copy", () => {
  assert.match(strudelPanel, /room-strudel-code:v1/);
  assert.match(collaborativeCodeEditor, /mergeTextEntrySplices/);
  assert.doesNotMatch(strudelPanel, /strudel loading/i);
});

function makeStrudelStore() {
  const doc = new Y.Doc();
  const store = syncedStore({ strudel: {} }, doc) as unknown as {
    strudel: CollaborativeRoomStrudelData;
  };

  return { doc, strudel: store.strudel };
}

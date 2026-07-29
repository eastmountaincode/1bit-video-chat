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
import { STRUDEL_SAMPLE_CATALOGS } from "./strudel-sample-catalogs.ts";
import { createStrudelSampleManifestResponse } from "./strudel-sample-manifest-response.ts";

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
const dirtSamplesManifest = JSON.parse(
  readFileSync(
    new URL(
      "./strudel-samples/dirt-samples.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Record<string, unknown>;
const drumkitManifest = JSON.parse(
  readFileSync(
    new URL("./strudel-samples/uzu-drumkit.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;
const drumMachinesManifest = JSON.parse(
  readFileSync(
    new URL(
      "./strudel-samples/tidal-drum-machines.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as Record<string, unknown>;

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
      code: 'note("d3")',
      disabled: false,
      revision: "update-revision",
      source: "telepathy-strudel",
      type: "update",
    }),
    true,
  );
  assert.equal(
    isStrudelFrameCommand({
      source: "telepathy-strudel",
      type: "stop",
    }),
    true,
  );
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
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /command\.type === "update"/,
  );
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /command\.type === "stop"/,
  );
  assert.match(STRUDEL_FRAME_DOCUMENT, /await api\.initAudio\(\)/);
  assert.match(STRUDEL_FRAME_DOCUMENT, /await api\.evaluate\(code\)/);
  assert.match(STRUDEL_FRAME_DOCUMENT, /await loadSampleCatalogs\(\)/);
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /if \(restart\) \{\s+api\.hush\(\);\s+restarted = true;/,
  );
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /evaluatePattern\(\s*command\.code,\s*command\.revision,\s*false,\s*\)/,
  );
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /evaluatePattern\(stagedCode, stagedRevision, true\)/,
  );
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /running = restarted \? false : wasRunning;/,
  );
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /event\.source !== window\.parent/,
  );
});

test("uses minimal controls that become update and stop while running", () => {
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /<button disabled hidden id="stop" type="button">stop<\/button>/,
  );
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /<button disabled id="run" type="button">run<\/button>/,
  );
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /runButton\.textContent = running \? "update" : "run";/,
  );
  assert.doesNotMatch(
    STRUDEL_FRAME_DOCUMENT,
    />\s*(?:run|stop) strudel\s*</i,
  );
});

test("loads official sample catalogs lazily and retries catalog failures", () => {
  assert.deepEqual(STRUDEL_SAMPLE_CATALOGS, [
    {
      baseUrl: "https://strudel.b-cdn.net/Dirt-Samples/",
      id: "dirt-samples",
      manifestUrl:
        "/strudel-samples-2026-07-29/dirt-samples.json",
    },
    {
      baseUrl: "https://strudel.b-cdn.net/uzu-drumkit/",
      id: "drumkit",
      manifestUrl: "/strudel-samples-2026-07-29/drumkit.json",
    },
    {
      baseUrl:
        "https://strudel.b-cdn.net/tidal-drum-machines/machines/",
      id: "drum-machines",
      manifestUrl:
        "/strudel-samples-2026-07-29/drum-machines.json",
    },
  ]);
  assert.match(STRUDEL_FRAME_DOCUMENT, /typeof api\.samples !== "function"/);
  assert.match(STRUDEL_FRAME_DOCUMENT, /function loadSampleCatalogs\(\)/);
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /api\.samples\(manifestUrl, baseUrl\)/,
  );
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /sampleCatalogsPromise = null;\s+throw error;/,
  );
  assert.doesNotMatch(STRUDEL_FRAME_DOCUMENT, /prebake:/);

  const audioIndex = STRUDEL_FRAME_DOCUMENT.indexOf(
    "await api.initAudio()",
  );
  const catalogsIndex = STRUDEL_FRAME_DOCUMENT.indexOf(
    "await loadSampleCatalogs()",
  );
  const evaluationIndex = STRUDEL_FRAME_DOCUMENT.indexOf(
    "await api.evaluate(code)",
  );
  assert.ok(audioIndex >= 0);
  assert.ok(audioIndex < catalogsIndex);
  assert.ok(catalogsIndex < evaluationIndex);
});

test("vendors Dirt, default, and Roland TR-909 sample metadata", () => {
  assert.ok(Array.isArray(dirtSamplesManifest.metal));
  assert.equal(dirtSamplesManifest.metal.length, 10);
  assert.equal(
    dirtSamplesManifest.metal[1],
    "metal/001_1.wav",
  );
  assert.equal(
    `${STRUDEL_SAMPLE_CATALOGS[0].baseUrl}${dirtSamplesManifest.metal[1]}`,
    "https://strudel.b-cdn.net/Dirt-Samples/metal/001_1.wav",
  );
  assert.ok(Array.isArray(drumkitManifest.bd));
  assert.ok(Array.isArray(drumkitManifest.hh));
  assert.ok(Array.isArray(drumkitManifest.sd));
  assert.ok(Array.isArray(drumMachinesManifest.RolandTR909_bd));
  assert.ok(Array.isArray(drumMachinesManifest.RolandTR909_hh));
  assert.ok(Array.isArray(drumMachinesManifest.RolandTR909_sd));

  for (const manifest of [
    dirtSamplesManifest,
    drumkitManifest,
    drumMachinesManifest,
  ]) {
    for (const [name, paths] of Object.entries(manifest)) {
      if (name === "_base") continue;
      assert.ok(Array.isArray(paths), `${name} should contain sample paths`);
      for (const path of paths) {
        assert.equal(typeof path, "string");
        assert.ok(path.length > 0);
        assert.doesNotMatch(path, /^(?:[a-z]+:)?\/\//i);
        assert.doesNotMatch(path, /(?:^|\/)\.\.(?:\/|$)/);
      }
    }
  }
});

test("serves sample metadata with stable cross-origin cache headers", async () => {
  const response =
    createStrudelSampleManifestResponse(dirtSamplesManifest);

  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=31536000, immutable",
  );
  assert.equal(
    response.headers.get("cross-origin-resource-policy"),
    "cross-origin",
  );
  assert.equal(
    response.headers.get("x-content-type-options"),
    "nosniff",
  );

  const manifest = (await response.json()) as {
    metal: string[];
  };
  assert.equal(manifest.metal[1], "metal/001_1.wav");
});

test("backs Strudel with the shared editor and no runtime messages", () => {
  assert.match(strudelPanel, /room-strudel-code:v1/);
  assert.match(strudelPanel, /onRunShortcut:/);
  assert.match(strudelPanel, /onStopShortcut:/);
  assert.match(
    strudelPanel,
    /aria-keyshortcuts="Control\+Enter Meta\+Enter Control\+\. Meta\+\."/,
  );
  assert.match(strudelPanel, /controlRef=\{runtimeControlsRef\}/);
  assert.match(
    strudelPanel,
    /runtimeControlsRef\.current\?\.update\(code\)/,
  );
  assert.match(strudelControls, /pendingUpdateRef/);
  assert.match(strudelControls, /readyRef\.current/);
  assert.match(collaborativeCodeEditor, /mergeTextEntrySplices/);
  assert.match(collaborativeCodeEditor, /getCodeEditorShortcut/);
  assert.doesNotMatch(strudelPanel, /strudel loading/i);
  assert.doesNotMatch(strudelPanel, /strudel error/i);
  assert.doesNotMatch(strudelPanel, /role="alert"/);
  assert.doesNotMatch(strudelPanel, /error-note/);
  assert.doesNotMatch(strudelControls, /onStatusChange/);
});

function makeStrudelStore() {
  const doc = new Y.Doc();
  const store = syncedStore({ strudel: {} }, doc) as unknown as {
    strudel: CollaborativeRoomStrudelData;
  };

  return { doc, strudel: store.strudel };
}

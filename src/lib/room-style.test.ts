import assert from "node:assert/strict";
import test from "node:test";

import { syncedStore } from "@syncedstore/core";
import * as Y from "yjs";

import {
  createRoomStyleDocument,
  getCollaborativeRoomStyleCss,
  MAX_ROOM_CSS_LENGTH,
  normalizeCollaborativeRoomStyleCss,
  readLegacyRoomStyleCss,
  ROOM_STYLE_SCAFFOLD,
  roomStyleUsesLivePixelMetadata,
  roomStyleUsesVideoPixelOverlay,
  syncLegacyRoomStyleCharacters,
  type CollaborativeRoomStyleData,
} from "./room-style.ts";
import {
  createTextEntries,
  readTextEntriesSafely,
} from "./shared-text-entries.ts";

test("keeps deliberate v4 CSS deletion and replacement intact", () => {
  assert.equal(normalizeCollaborativeRoomStyleCss("", 4), "");
  assert.equal(
    normalizeCollaborativeRoomStyleCss("body { color: red; }", 4),
    "body { color: red; }",
  );
});

test("repairs legacy CSS once and only caps current CSS", () => {
  const legacy = normalizeCollaborativeRoomStyleCss(
    "body { color: red; }",
    3,
  );
  assert.match(legacy, /\[data-room-part="room"\]/);
  assert.equal(
    normalizeCollaborativeRoomStyleCss(
      "x".repeat(MAX_ROOM_CSS_LENGTH + 10),
      4,
    ).length,
    MAX_ROOM_CSS_LENGTH,
  );
});

test("falls back safely when a shared document is malformed", () => {
  const malformed: CollaborativeRoomStyleData = {
    chars: null,
    current: {
      createdAt: 0,
      entries: ["bad"],
      id: "malformed",
    },
    updatedAt: 0,
    updatedBy: "",
    version: 4,
  };

  assert.equal(
    getCollaborativeRoomStyleCss(malformed, ROOM_STYLE_SCAFFOLD),
    ROOM_STYLE_SCAFFOLD,
  );
});

test("validates and caps the rolling v3 character mirror", () => {
  assert.equal(readLegacyRoomStyleCss(["a", "b", "c"], 2), "ab");
  assert.equal(readLegacyRoomStyleCss(["a", "bc"], 2), null);
  assert.equal(readLegacyRoomStyleCss(["a", 2], 2), null);
});

test("repairs the rolling v3 mirror as one complete array", () => {
  const style: CollaborativeRoomStyleData = {
    chars: ["a", "b", "c"],
    current: createRoomStyleDocument("abc", "current", 0),
    updatedAt: 0,
    updatedBy: "",
    version: 3,
  };
  const originalCharacters = style.chars;

  assert.equal(syncLegacyRoomStyleCharacters(style, "axc"), true);
  assert.notEqual(style.chars, originalCharacters);
  assert.deepEqual(style.chars, ["a", "x", "c"]);
  assert.equal(syncLegacyRoomStyleCharacters(style, "axc"), false);

  assert.equal(
    syncLegacyRoomStyleCharacters(
      style,
      "y".repeat(MAX_ROOM_CSS_LENGTH + 10),
    ),
    true,
  );
  assert.equal(style.chars?.length, MAX_ROOM_CSS_LENGTH);
});

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

test("20 simultaneous resets select one complete document epoch", () => {
  const seed = makeStyleStore();
  const initialCss = "body { color: red; }";
  seed.style.current = createRoomStyleDocument(
    initialCss,
    "seed",
    0,
  );
  seed.style.chars = initialCss.split("");
  seed.style.updatedAt = 0;
  seed.style.updatedBy = "";
  seed.style.version = 3;
  const seedUpdate = Y.encodeStateAsUpdate(seed.doc);
  const clients = Array.from({ length: 20 }, (_, index) => {
    const client = makeStyleStore();
    Y.applyUpdate(client.doc, seedUpdate);
    client.style.current = createRoomStyleDocument(
      ROOM_STYLE_SCAFFOLD,
      `reset-${index}`,
      index + 1,
    );
    syncLegacyRoomStyleCharacters(
      client.style,
      ROOM_STYLE_SCAFFOLD,
    );
    return client;
  });

  const repairUpdates = clients.map((client) =>
    Y.encodeStateAsUpdate(client.doc),
  );
  for (const target of clients) {
    for (const update of repairUpdates) {
      Y.applyUpdate(target.doc, update);
    }
  }

  const selectedIds = new Set(
    clients.map((client) => client.style.current?.id),
  );
  assert.equal(selectedIds.size, 1);

  for (const client of clients) {
    const text = client.style.current?.entries
      .map((entry) => entry.slice(entry.indexOf("\u0000") + 1))
      .join("");
    assert.equal(text, ROOM_STYLE_SCAFFOLD);
    assert.equal(
      text?.split('[data-room-part="style"]').length - 1,
      1,
    );
    assert.equal(client.style.chars?.join(""), ROOM_STYLE_SCAFFOLD);
  }
});

test("20 compatibility bridges converge after a legacy v3 edit", (context) => {
  const initialCss = "body { color: red; }";
  const legacyCss = "body { color: blue; }";
  const seed = makeStyleStore();
  seed.style.current = createRoomStyleDocument(
    initialCss,
    "seed",
    0,
  );
  seed.style.chars = initialCss.split("");
  seed.style.updatedAt = 0;
  seed.style.updatedBy = "";
  seed.style.version = 3;
  const seedUpdate = Y.encodeStateAsUpdate(seed.doc);
  const legacyClient = makeStyleStore();
  Y.applyUpdate(legacyClient.doc, seedUpdate);
  legacyClient.style.chars?.splice(
    0,
    initialCss.length,
    ...legacyCss.split(""),
  );
  const legacyUpdate = Y.encodeStateAsUpdate(legacyClient.doc);
  const clients = Array.from({ length: 20 }, () => {
    const client = makeStyleStore();
    Y.applyUpdate(client.doc, seedUpdate);
    Y.applyUpdate(client.doc, legacyUpdate);
    return client;
  });

  let rounds = 0;
  for (; rounds < 4; rounds += 1) {
    for (let index = 0; index < clients.length; index += 1) {
      bridgeLegacyMirror(clients[index].style, `bridge-${rounds}-${index}`);
    }
    const updates = clients.map((client) =>
      Y.encodeStateAsUpdate(client.doc),
    );
    for (const target of clients) {
      for (const update of updates) {
        Y.applyUpdate(target.doc, update);
      }
    }

    if (
      clients.every(
        (client) =>
          getCollaborativeRoomStyleCss(client.style, "") === legacyCss &&
          client.style.chars?.join("") === legacyCss,
      )
    ) {
      break;
    }
  }

  context.diagnostic(
    `20 rolling-version bridges converged in ${rounds + 1} round(s)`,
  );
  assert.equal(rounds, 0);
  for (const client of clients) {
    assert.equal(
      getCollaborativeRoomStyleCss(client.style, ""),
      legacyCss,
    );
    assert.equal(client.style.chars?.join(""), legacyCss);
  }
});

test("20 over-limit replicas converge after atomic epoch repair", () => {
  const seed = makeStyleStore();
  seed.style.current = createRoomStyleDocument(
    "x".repeat(19_000),
    "seed",
    0,
  );
  seed.style.chars = null;
  seed.style.version = 4;
  const seedUpdate = Y.encodeStateAsUpdate(seed.doc);
  const clients = Array.from({ length: 20 }, (_, index) => {
    const client = makeStyleStore();
    Y.applyUpdate(client.doc, seedUpdate);
    client.style.current?.entries.push(
      ...createTextEntries(
        "y".repeat(1_000),
        `client-${index}`,
      ),
    );
    return client;
  });
  const overflow = makeStyleStore();

  for (const client of clients) {
    Y.applyUpdate(
      overflow.doc,
      Y.encodeStateAsUpdate(client.doc),
    );
  }
  assert.equal(overflow.style.current?.entries.length, 39_000);

  const overflowUpdate = Y.encodeStateAsUpdate(overflow.doc);
  for (let index = 0; index < clients.length; index += 1) {
    const client = clients[index];
    Y.applyUpdate(client.doc, overflowUpdate);
    const entries = client.style.current?.entries ?? [];
    const css = readTextEntriesSafely(
      entries,
      MAX_ROOM_CSS_LENGTH,
    );
    assert.notEqual(css, null);
    client.style.current = createRoomStyleDocument(
      css ?? "",
      `repair-${index}`,
      index + 1,
    );
  }

  const convergedRepairUpdates = clients.map((client) =>
    Y.encodeStateAsUpdate(client.doc),
  );
  for (const target of clients) {
    for (const update of convergedRepairUpdates) {
      Y.applyUpdate(target.doc, update);
    }
  }

  const selectedIds = new Set(
    clients.map((client) => client.style.current?.id),
  );
  assert.equal(selectedIds.size, 1);
  for (const client of clients) {
    assert.equal(
      client.style.current?.entries.length,
      MAX_ROOM_CSS_LENGTH,
    );
  }
});

test("20 over-limit v3 mirrors converge after one atomic repair", () => {
  const initialCss = "x".repeat(19_000);
  const seed = makeStyleStore();
  seed.style.current = createRoomStyleDocument(
    initialCss,
    "seed",
    0,
  );
  seed.style.chars = initialCss.split("");
  seed.style.updatedAt = 0;
  seed.style.updatedBy = "";
  seed.style.version = 3;
  const seedUpdate = Y.encodeStateAsUpdate(seed.doc);
  const clients = Array.from({ length: 20 }, (_, index) => {
    const client = makeStyleStore();
    Y.applyUpdate(client.doc, seedUpdate);
    client.style.chars?.push(
      ..."y".repeat(1_000).split(""),
    );
    return { ...client, index };
  });
  const overflow = makeStyleStore();

  for (const client of clients) {
    Y.applyUpdate(
      overflow.doc,
      Y.encodeStateAsUpdate(client.doc),
    );
  }
  assert.equal(overflow.style.chars?.length, 39_000);
  const overflowUpdate = Y.encodeStateAsUpdate(overflow.doc);

  for (const client of clients) {
    Y.applyUpdate(client.doc, overflowUpdate);
    const legacyCss = readLegacyRoomStyleCss(
      client.style.chars ?? [],
      MAX_ROOM_CSS_LENGTH,
    );
    assert.notEqual(legacyCss, null);
    client.style.current = createRoomStyleDocument(
      legacyCss ?? "",
      `repair-${client.index}`,
      client.index + 1,
    );
    syncLegacyRoomStyleCharacters(
      client.style,
      legacyCss ?? "",
    );
  }

  const updates = clients.map((client) =>
    Y.encodeStateAsUpdate(client.doc),
  );
  for (const target of clients) {
    for (const update of updates) {
      Y.applyUpdate(target.doc, update);
    }
  }

  for (const client of clients) {
    assert.equal(client.style.chars?.length, MAX_ROOM_CSS_LENGTH);
    assert.equal(
      client.style.current?.entries.length,
      MAX_ROOM_CSS_LENGTH,
    );
    assert.equal(
      getCollaborativeRoomStyleCss(client.style, ""),
      client.style.chars?.join(""),
    );
  }
});

function makeStyleStore() {
  const doc = new Y.Doc();
  const store = syncedStore({ style: {} }, doc) as unknown as {
    style: CollaborativeRoomStyleData;
  };

  return { doc, style: store.style };
}

function bridgeLegacyMirror(
  style: CollaborativeRoomStyleData,
  prefix: string,
) {
  const entries = style.current?.entries;
  const legacyCss = Array.isArray(style.chars)
    ? readLegacyRoomStyleCss(style.chars, MAX_ROOM_CSS_LENGTH)
    : null;
  const currentCss = Array.isArray(entries)
    ? readTextEntriesSafely(entries, MAX_ROOM_CSS_LENGTH)
    : null;
  if (
    !Array.isArray(entries) ||
    legacyCss === null ||
    currentCss === null ||
    legacyCss === currentCss
  ) {
    return;
  }

  style.current = createRoomStyleDocument(
    legacyCss,
    prefix,
    Date.now(),
  );
  syncLegacyRoomStyleCharacters(style, legacyCss);
}

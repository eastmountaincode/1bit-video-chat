import assert from "node:assert/strict";
import test from "node:test";

import { syncedStore } from "@syncedstore/core";
import * as Y from "yjs";

import {
  createRoomStyleDocument,
  DEFAULT_ROOM_STYLE_TARGETS,
  ensureRoomStyleScaffold,
  getCollaborativeRoomStyleCss,
  MAX_ROOM_CSS_LENGTH,
    migrateRoomStyleCss,
  normalizeCollaborativeRoomStyleCss,
  readLegacyRoomStyleCss,
  removeObsoleteRoomStyleTargets,
  ROOM_STYLE_SCAFFOLD,
    ROOM_STYLE_TEMPLATE_REVISION,
    ROOM_STYLE_TARGETS,
  syncLegacyRoomStyleCharacters,
  type CollaborativeRoomStyleData,
} from "./room-style.ts";
import {
  createTextEntries,
  readTextEntriesSafely,
} from "./shared-text-entries.ts";

test("simplifies the old default template while preserving customized declarations", () => {
    const original = ROOM_STYLE_TARGETS.filter((selector) =>
        !/message-(author|time|text)|video-(caption|rate)"\]\[data-side/.test(selector))
        .map((selector) => `${selector} {\n  \n}`).join("\n\n");
    assert.equal(migrateRoomStyleCss(original), ROOM_STYLE_SCAFFOLD);
    const customized = original.replace('[data-room-part="room"] {', '[data-room-part="room"] { color: red;');
    const migrated = migrateRoomStyleCss(customized);
    assert.match(migrated, /\/\* The whole room\. \*\//);
    assert.match(migrated, /\[data-room-part="room"\] \{ color: red;/);
    assert.doesNotMatch(migrated, /data-room-part="divider"/);
    assert.doesNotMatch(migrated, /data-room-part="video-area"/);
    for (const selector of DEFAULT_ROOM_STYLE_TARGETS) assert.ok(migrated.includes(selector));
    assert.equal(migrateRoomStyleCss(""), "");
});

test("default and migrated room selectors use data-side for both chat and video", () => {
    assert.doesNotMatch(ROOM_STYLE_SCAFFOLD, /data-(video|message)-side/);
    const css = '[data-room-part="message"][data-message-side="own"] { color: red; }\n' +
        '[data-room-part="video-card"][data-video-side="own"] { border: 3px solid green; }';
    const migrated = migrateRoomStyleCss(css, 1, 3);
    assert.equal(migrated, css.replaceAll("data-message-side", "data-side").replaceAll("data-video-side", "data-side"));
});

test("comment migration skips strings and existing comments and respects the size limit", () => {
    const css = `/* My background. */\n[data-room-part="room"] { color: red; }\n` +
        `body { content: '[data-room-part="title"] {}'; }\n` +
        `/* [data-room-part="video-area"] {} */\n` +
        `@media (width < 700px) {\n    [data-room-part = 'title'] { color: blue; }\n}`;
    const migrated = migrateRoomStyleCss(css);
    assert.equal(migrated, css.replace("    [data-room-part = 'title']", "    /* The room title. */\n    [data-room-part = 'title']"));
    assert.equal(migrateRoomStyleCss(migrated), migrated);
    const full = '[data-room-part="room"] {' + ' '.repeat(MAX_ROOM_CSS_LENGTH - 26) + '}';
    assert.equal(migrateRoomStyleCss(full), full);
});

test("does not restore comments deliberately removed after migration", () => {
    const withoutComments = ROOM_STYLE_SCAFFOLD.replace(/\/\*.*?\*\/\n/g, "");
    assert.equal(migrateRoomStyleCss(withoutComments, 1, ROOM_STYLE_TEMPLATE_REVISION), withoutComments);
    assert.equal(migrateRoomStyleCss(ROOM_STYLE_SCAFFOLD, 1, ROOM_STYLE_TEMPLATE_REVISION), ROOM_STYLE_SCAFFOLD);
});

test("template cleanup retains styled advanced targets, personal notes, strings, and nested rules", () => {
    const css = `/* My divider experiment. */\n[data-room-part="divider"] { background: red; }\n` +
        `/* Keep this note. */\n[data-room-part="sidebar"] {}\n` +
        `body { content: '[data-room-part="video-area"] {}'; }\n` +
        `@media (width < 700px) { [data-room-part="leave"] {} }\n` +
        `[data-room-part="chat"] { color: blue; }`;
    const migrated = migrateRoomStyleCss(css, 1);
    assert.match(migrated, /divider"\] \{ background: red;/);
    assert.ok(migrated.includes('/* Keep this note. */'));
    assert.ok(migrated.includes(`body { content: '[data-room-part="video-area"] {}'; }`));
    assert.ok(migrated.includes('@media (width < 700px) { [data-room-part="leave"] {} }'));
    assert.ok(migrated.includes('[data-room-part="message-author"]'));
    assert.equal(migrateRoomStyleCss(migrated, 1, ROOM_STYLE_TEMPLATE_REVISION), migrated);
    const removedByUser = migrated.replace(/\/\* Names in chat\. \*\/\n\[data-room-part="message-author"\]\s*\{\s*\}/, "");
    assert.equal(migrateRoomStyleCss(removedByUser, 1, ROOM_STYLE_TEMPLATE_REVISION), removedByUser);
});

test("scaffolding does not truncate custom CSS to make room for default sections", () => {
    const css = `body { --value: "${"x".repeat(MAX_ROOM_CSS_LENGTH - 23)}"; }`;
    assert.ok(css.length <= MAX_ROOM_CSS_LENGTH);
    assert.equal(ensureRoomStyleScaffold(css), css);
    assert.equal(DEFAULT_ROOM_STYLE_TARGETS.length, 11);
});

test("simplifies existing defaults without removing custom grid or message text styles", () => {
    const css = `/* How the videos are arranged. */\n[data-room-part="video-grid"] {\n    \n}\n` +
        `/* The text of each message. */\n[data-room-part="message-text"] {}\n` +
        `/* Your chat messages. */\n[data-room-part="message"][data-side="own"] { color: red; }`;
    const migrated = migrateRoomStyleCss(css, 1, 1);
    assert.doesNotMatch(migrated, /video-grid|message-text/);
    assert.match(migrated, /\/\* Your own chat messages\. \*\//);
    assert.match(migrated, /color: red;/);
    assert.doesNotMatch(migrated, /message-author|message-time/);
    assert.equal(migrateRoomStyleCss(migrated, 1, ROOM_STYLE_TEMPLATE_REVISION), migrated);

    const custom = `[data-room-part="video-grid"] { gap: 2rem; }\n` +
        `[data-room-part="message-text"] { color: green; }\n` +
        `body { content: '/* Your chat messages. */'; }`;
    assert.equal(migrateRoomStyleCss(custom, 1, 1), custom);
    assert.equal(migrateRoomStyleCss(css, 1, ROOM_STYLE_TEMPLATE_REVISION + 1), css);
    const full = '/* Your chat messages. */\nbody { color: red; }'.padEnd(MAX_ROOM_CSS_LENGTH, ' ');
    assert.equal(migrateRoomStyleCss(full, 1, 1), full);
});

test("keeps deliberate v4 CSS deletion and replacement intact", () => {
  assert.equal(normalizeCollaborativeRoomStyleCss("", 4), "");
  assert.equal(
    normalizeCollaborativeRoomStyleCss("body { color: red; }", 4),
    "body { color: red; }",
  );
});

test("adds own video examples without narrowing existing styles for everyone", () => {
    const css = '/* The name below each video. */\n[data-room-part="video-caption"] { color: red; }';
    const migrated = migrateRoomStyleCss(css, 1, 2);
    assert.ok(migrated.startsWith(css));
    assert.match(migrated, /\[data-room-part="video-caption"\]\[data-side="own"\]/);
    assert.match(migrated, /\[data-room-part="video-rate"\]\[data-side="own"\]/);
    assert.equal(migrateRoomStyleCss(migrated, 1, ROOM_STYLE_TEMPLATE_REVISION), migrated);

    const empty = '/* The name below each video. */\n[data-room-part="video-caption"] {}';
    const updated = migrateRoomStyleCss(empty, 1, 2);
    assert.doesNotMatch(updated, /\[data-room-part="video-caption"\]\s*\{/);
    assert.doesNotMatch(updated, /The name below each video/);
    assert.match(updated, /The name below your own video/);
});

test("keeps ad hoc ownership rules and deliberate removal of the own condition", () => {
    const css = '[data-room-part="message-author"][data-side="own"] { color: red; }\n' +
        '[data-room-part="message-time"][data-side="other"] { color: blue; }\n' +
        '[data-room-part="video-caption"] { font-size: 2em; }\n' +
        '.my-custom-selector { outline: 1px solid pink; }';
    assert.equal(migrateRoomStyleCss(css, 1, ROOM_STYLE_TEMPLATE_REVISION), css);
    assert.equal(normalizeCollaborativeRoomStyleCss(css, 4), css);
    const full = css.padEnd(MAX_ROOM_CSS_LENGTH, ' ');
    assert.equal(migrateRoomStyleCss(full, 1, 2), full);
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

test("removes retired room targets without changing supported CSS", () => {
  const oldCss = [
    '[data-room-part="room"] { color: black; }',
    '[data-room-part="strudel"] { color: blue; }',
    '[data-room-part="video-pixel"] { filter: blur(1px); }',
    '[data-room-part="video-frame"] { background: white; }',
  ].join("\n");
  const migrated = removeObsoleteRoomStyleTargets(oldCss);

  assert.doesNotMatch(migrated, /strudel|video-pixel|blur/);
  assert.match(migrated, /\[data-room-part="room"\]/);
  assert.match(migrated, /\[data-room-part="video-frame"\]/);
  assert.equal(removeObsoleteRoomStyleTargets(migrated), migrated);
});

test("does not splice a longer pixel selector into the following rule", () => {
  const css = [
    '[data-room-part="video-frame"] > [data-room-part="video-pixel"] {',
    "  border: 1px solid red;",
    "}",
    '[data-room-part="video-caption"] { color: red; }',
  ].join("\n");

  assert.equal(removeObsoleteRoomStyleTargets(css), css);
});

test("removes repeated standalone retired blocks in one migration", () => {
  const css = [
    '[data-room-part="video-pixel"] {}',
    '[data-room-part="video-pixel"] { filter: blur(1px); }',
    '[data-room-part="video-frame"] {}',
  ].join("\n");
  const migrated = removeObsoleteRoomStyleTargets(css);

  assert.doesNotMatch(migrated, /video-pixel|blur/);
  assert.match(migrated, /\[data-room-part="video-frame"\]/);
});

test("keeps retired targets out of new and existing v3 styles", () => {
  assert.doesNotMatch(ROOM_STYLE_SCAFFOLD, /strudel/);
  assert.doesNotMatch(ROOM_STYLE_SCAFFOLD, /video-pixel/);

  const migrated = normalizeCollaborativeRoomStyleCss(
    '[data-room-part="video-pixel"] { border: 1px solid red; }',
    3,
  );

  assert.doesNotMatch(migrated, /video-pixel/);
  assert.match(migrated, /\[data-room-part="video-card"\]/);
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
      text?.split('[data-room-part="chat"]').length - 1,
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

import * as Y from "yjs";
import YProvider from "y-partyserver/provider";

import {
  createTextEntries,
  readTextEntriesSafely,
} from "../src/lib/shared-text-entries.ts";

const CLIENT_COUNT = readPositiveInteger(
  process.env.TELEPATHY_STYLE_RELAY_CLIENTS,
  20,
);
const ROUND_COUNT = readPositiveInteger(
  process.env.TELEPATHY_STYLE_RELAY_ROUNDS,
  10,
);
const SYNC_TIMEOUT_MS = 20_000;
const HOST = "playhtml.spencerc99.workers.dev";

if (typeof WebSocket !== "function") {
  throw new Error("This benchmark requires Node.js 22 or newer");
}

process.setMaxListeners(0);

const room =
  `telepathy-style-load-${Date.now().toString(36)}-` +
  Math.random().toString(36).slice(2, 10);
const documents = Array.from(
  { length: CLIENT_COUNT },
  () => new Y.Doc(),
);
const providers = documents.map(
  (document, index) =>
    new YProvider(HOST, room, document, {
      connectionId:
        `load-${index}-` + Math.random().toString(36).slice(2),
      disableBc: true,
      params: {
        sharedElements: "[]",
        sharedReferences: "[]",
      },
      WebSocketPolyfill: WebSocket,
    }),
);
let observedUpdateBytes = 0;

for (const document of documents) {
  document.on("update", (update) => {
    observedUpdateBytes += update.byteLength;
  });
}

try {
  const initialSyncMs = await waitUntil(
    () => providers.every((provider) => provider.synced),
    SYNC_TIMEOUT_MS,
    "initial sync",
  );

  seedStyleDocument(documents[0]);
  await waitUntil(
    () =>
      documents.every((document) => readStyle(document) !== null),
    SYNC_TIMEOUT_MS,
    "seed fan-out",
  );

  for (const provider of providers) provider.disconnect();
  await wait(100);
  for (let index = 0; index < CLIENT_COUNT; index += 1) {
    appendStyleEdit(
      documents[index],
      `\n/* offline participant ${index.toString().padStart(2, "0")} */`,
      `offline-${index}`,
    );
  }

  const reconnectStartedAt = performance.now();
  for (const provider of providers) provider.connect();
  await waitUntil(
    () =>
      documentsConverged() &&
      documents.every((document) => styleMirrorsMatch(document)),
    SYNC_TIMEOUT_MS,
    "offline convergence",
  );
  const offlineReconnectConvergenceMs =
    performance.now() - reconnectStartedAt;

  const roundLatenciesMs = [];
  for (let round = 0; round < ROUND_COUNT; round += 1) {
    const startedAt = performance.now();
    for (let index = 0; index < CLIENT_COUNT; index += 1) {
      appendStyleEdit(
        documents[index],
        `\n/* round ${round} participant ${index} */`,
        `round-${round}-${index}`,
      );
    }
    await waitUntil(
      () =>
        documentsConverged() &&
        documents.every((document) => styleMirrorsMatch(document)),
      SYNC_TIMEOUT_MS,
      `connected round ${round}`,
    );
    roundLatenciesMs.push(performance.now() - startedAt);
  }

  const sortedLatencies = [...roundLatenciesMs].sort(
    (left, right) => left - right,
  );
  const finalStyle = readStyle(documents[0]);
  console.log(
    JSON.stringify(
      {
        clients: CLIENT_COUNT,
        connectedRounds: ROUND_COUNT,
        converged: documentsConverged(),
        finalCssLength: finalStyle?.css.length ?? 0,
        mirrorsMatch: documents.every((document) =>
          styleMirrorsMatch(document),
        ),
        initialSyncMs: round(initialSyncMs),
        offlineReconnectConvergenceMs: round(
          offlineReconnectConvergenceMs,
        ),
        roundLatencyMedianMs: round(percentile(sortedLatencies, 0.5)),
        roundLatencyP90Ms: round(percentile(sortedLatencies, 0.9)),
        roundLatencyMinMs: round(sortedLatencies[0]),
        totalObservedUpdateBytes: observedUpdateBytes,
      },
      null,
      2,
    ),
  );
} finally {
  for (const provider of providers) provider.destroy();
  for (const document of documents) document.destroy();
}

function documentsConverged() {
  const snapshots = documents.map((document) =>
    JSON.stringify({
      chars: document
        .getMap("room-style:v2")
        .get("chars")
        ?.toArray(),
      entries: document
        .getMap("room-style:v2")
        .get("entries")
        ?.toArray(),
      version: document.getMap("room-style:v2").get("version"),
    }),
  );
  return snapshots.every((snapshot) => snapshot === snapshots[0]);
}

function seedStyleDocument(document) {
  const css = [
    '[data-room-part="room"] {',
    "  color: black;",
    "}",
    "",
    '[data-room-part="video-pixel"] {',
    "  background: white;",
    "}",
  ].join("\n");
  const root = document.getMap("room-style:v2");
  const entries = new Y.Array();
  const chars = new Y.Array();

  document.transact(() => {
    entries.push(createTextEntries(css, "b"));
    chars.push(css.split(""));
    root.set("entries", entries);
    root.set("chars", chars);
    root.set("version", 3);
  });
}

function appendStyleEdit(document, text, prefix) {
  const root = document.getMap("room-style:v2");
  const entries = root.get("entries");
  const chars = root.get("chars");
  if (!(entries instanceof Y.Array) || !(chars instanceof Y.Array)) {
    throw new Error("Style document has not synchronized");
  }

  document.transact(() => {
    entries.insert(
      entries.length,
      createTextEntries(text, prefix),
    );
    chars.insert(chars.length, text.split(""));
  });
}

function readStyle(document) {
  const root = document.getMap("room-style:v2");
  const entries = root.get("entries");
  const chars = root.get("chars");
  if (!(entries instanceof Y.Array) || !(chars instanceof Y.Array)) {
    return null;
  }

  const css = readTextEntriesSafely(entries.toArray());
  if (css === null) return null;
  return { css, mirror: chars.toArray().join("") };
}

function styleMirrorsMatch(document) {
  const style = readStyle(document);
  return style !== null && style.css === style.mirror;
}

async function waitUntil(predicate, timeoutMs, label) {
  const startedAt = performance.now();
  while (!predicate()) {
    if (performance.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await wait(20);
  }
  return performance.now() - startedAt;
}

function wait(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function percentile(sortedValues, fraction) {
  const index = Math.min(
    sortedValues.length - 1,
    Math.ceil(sortedValues.length * fraction) - 1,
  );
  return sortedValues[index];
}

function round(value) {
  return Number(value.toFixed(1));
}

function readPositiveInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received "${value}"`);
  }
  return parsed;
}

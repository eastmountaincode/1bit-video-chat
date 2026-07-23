import assert from "node:assert/strict";
import test from "node:test";

import type { GrayscaleFrame } from "./shared-types.ts";
import {
  applyVideoPresenceServerMessage,
  assembleVideoPresenceParticipants,
  createVideoPresencePublishBatch,
  getPresenceValueByteLength,
  getVideoPresenceBatchMessageCount,
  LatestVideoPresencePublisher,
  parseVideoFrameChunk,
  parseVideoFrameMetadata,
  parseVideoPresenceServerMessage,
  VIDEO_PRESENCE_CHANNEL,
  VIDEO_PRESENCE_MAX_VALUE_BYTES,
  type VideoPresencePeerState,
  type VideoPresencePublishBatch,
  type VideoPresenceSocketLike,
} from "./video-presence-protocol.ts";

test("inlines default frames and chunks larger frames into safe values", () => {
  const defaultBatch = createVideoPresencePublishBatch({
    frame: makeFrame(100, 75, 3),
    name: "A".repeat(24),
    payloadRate: {
      bytesPerSecond: 50_000,
      measuredAt: 1_000,
      windowMs: 1_000,
    },
    publishedAt: 1_000,
    sequence: 1,
  });
  const maximumBatch = createBatch(makeFrame(216, 162, 5), 2);

  assert.equal(defaultBatch.chunkCount, 0);
  assert.equal(defaultBatch.messages.length, 1);
  const defaultMetadata = asRecord(defaultBatch.messages[0]?.value);
  assert.equal("name" in defaultMetadata, false);
  assert.equal("payloadRate" in defaultMetadata, false);
  assert.equal(
    parseVideoFrameMetadata(defaultBatch.messages[0]?.value)?.data,
    makeFrame(100, 75, 3).data,
  );
  assert.equal(maximumBatch.chunkCount, 8);
  assert.equal(maximumBatch.messages.length, 9);

  for (const batch of [defaultBatch, maximumBatch]) {
    assert.equal(batch.messages.at(-1)?.channel, VIDEO_PRESENCE_CHANNEL);
    for (const message of batch.messages) {
      assert.ok(
        getPresenceValueByteLength(message.value) <=
          VIDEO_PRESENCE_MAX_VALUE_BYTES,
      );
    }

    const participants = assembleVideoPresenceParticipants(
      makePeers("connection", "identity", batch),
    );
    assert.equal(participants.length, 1);
    assert.equal(participants[0]?.name, "Ada");
    assert.equal(participants[0]?.payloadRate, undefined);
    assert.deepEqual(participants[0]?.frame, frameFromBatch(batch));
  }
});

test("reads participant names from identity and accepts legacy frame metadata", () => {
  const batch = createBatch(makeFrame(100, 75, 3), 1);
  const metadata = asRecord(batch.messages.at(-1)?.value);
  const legacyMetadata = {
    ...metadata,
    name: "Old frame name",
    payloadRate: {
      bytesPerSecond: 50_000,
      measuredAt: 1_000,
      windowMs: 1_000,
    },
  };
  const parsed = parseVideoFrameMetadata(legacyMetadata);
  assert.ok(parsed);
  assert.equal("name" in parsed, false);
  assert.equal("payloadRate" in parsed, false);

  const participants = assembleVideoPresenceParticipants(
    new Map([
      [
        "connection",
        new Map<string, unknown>([
          ["identity", { name: "Identity name", publicKey: "identity" }],
          [VIDEO_PRESENCE_CHANNEL, legacyMetadata],
        ]),
      ],
    ]),
  );
  assert.equal(participants[0]?.name, "Identity name");
  assert.equal(participants[0]?.payloadRate, undefined);
});

test("rejects malformed metadata, chunks, frames, and server messages", () => {
  const valid = createBatch(makeFrame(100, 75, 3), 1);
  const chunked = createBatch(makeFrame(216, 162, 5), 2);
  const metadata = valid.messages.at(-1)?.value;
  const chunk = chunked.messages[0]?.value;

  assert.ok(parseVideoFrameMetadata(metadata));
  assert.ok(parseVideoFrameChunk(chunk));
  assert.equal(
    parseVideoFrameMetadata({ ...asRecord(metadata), dataLength: 4 }),
    null,
  );
  assert.equal(
    parseVideoFrameMetadata({ ...asRecord(metadata), data: "!" }),
    null,
  );
  assert.equal(
    parseVideoFrameChunk({ ...asRecord(chunk), data: "!" }),
    null,
  );
  assert.equal(parseVideoPresenceServerMessage("{bad json"), null);
  assert.throws(
    () =>
      createBatch(
        {
          ...makeFrame(100, 75, 3),
          data: `${"A".repeat(3_751)}!`,
        },
        2,
      ),
    /Base64/,
  );
});

test("applies server changes, commits complete frames, and dedupes identity", () => {
  const older = createBatch(makeFrame(100, 75, 3, 1), 1, 1_000);
  const newer = createBatch(makeFrame(100, 75, 3, 2), 2, 2_000);
  const peers: VideoPresencePeerState = new Map();
  const sync = parseVideoPresenceServerMessage(
    JSON.stringify({
      peers: {
        first: peerRecord("same-person", older),
        second: peerRecord("same-person", newer),
      },
      type: "presence-sync",
    }),
  );

  assert.ok(sync);
  assert.equal(applyVideoPresenceServerMessage(peers, sync), true);

  const participants = assembleVideoPresenceParticipants(peers);
  assert.equal(participants.length, 1);
  assert.equal(participants[0]?.connectionId, "second");
  assert.equal(participants[0]?.sequence, 2);
  assert.deepEqual(
    assembleVideoPresenceParticipants(peers, "same-person"),
    [],
  );

  const removal = parseVideoPresenceServerMessage(
    JSON.stringify({
      removes: {
        second: ["identity", "video", "video:chunk:0"],
      },
      type: "presence-changes",
      updates: {},
    }),
  );
  assert.ok(removal);
  assert.equal(applyVideoPresenceServerMessage(peers, removal), true);
  assert.equal(assembleVideoPresenceParticipants(peers).length, 1);
  assert.equal(
    assembleVideoPresenceParticipants(peers)[0]?.connectionId,
    "first",
  );
});

test("publisher keeps only the latest frame while closed or backpressured", () => {
  const socket = new FakeSocket();
  const publisher = new LatestVideoPresencePublisher(() => socket);
  const first = createBatch(makeFrame(100, 75, 3, 1), 1);
  const second = createBatch(makeFrame(100, 75, 3, 2), 2);
  const third = createBatch(makeFrame(100, 75, 3, 3), 3);

  publisher.submit(first, 0);
  publisher.submit(second, 10);
  assert.equal(socket.sent.length, 0);

  socket.readyState = 1;
  assert.equal(publisher.replay(100).sent, true);
  assert.deepEqual(sentFrameIds(socket.sent), [second.frameId]);

  assert.equal(publisher.submit(third, 120).sent, true);
  assert.deepEqual(sentFrameIds(socket.sent), [second.frameId, third.frameId]);

  socket.bufferedAmount = 64 * 1_024;
  publisher.submit(first, 210);
  publisher.submit(second, 220);
  assert.equal(publisher.hasPendingFrame, true);

  socket.bufferedAmount = 0;
  assert.equal(publisher.flush(250).sent, true);
  assert.deepEqual(sentFrameIds(socket.sent), [
    second.frameId,
    third.frameId,
    second.frameId,
  ]);
});

test("publisher budgets every message in a rolling one-second window", () => {
  const socket = new FakeSocket();
  socket.readyState = 1;
  const publisher = new LatestVideoPresencePublisher(() => socket);
  const firstLarge = createBatch(makeFrame(216, 162, 5), 1);
  const secondLarge = createBatch(makeFrame(216, 162, 5), 2);
  const thirdLarge = createBatch(makeFrame(216, 162, 5), 3);
  const inline = createBatch(makeFrame(100, 75, 3), 4);

  assert.equal(getVideoPresenceBatchMessageCount(firstLarge), 9);
  assert.equal(getVideoPresenceBatchMessageCount(inline, 8), 9);
  assert.equal(publisher.submit(firstLarge, 0).sent, true);
  assert.equal(socket.sent.length, 9);
  assert.equal(publisher.submit(secondLarge, 450).sent, true);
  assert.equal(socket.sent.length, 18);

  const windowLimited = publisher.submit(thirdLarge, 900);
  assert.equal(windowLimited.sent, false);
  assert.equal(windowLimited.retryAfterMs, 100);
  assert.equal(publisher.flush(999).retryAfterMs, 1);
  assert.equal(publisher.flush(1_000).sent, true);
  assert.equal(socket.sent.length, 27);

  const staleClearsAreCounted = publisher.submit(inline, 1_001);
  assert.equal(staleClearsAreCounted.sent, false);
  assert.equal(staleClearsAreCounted.retryAfterMs, 449);
  assert.equal(publisher.flush(1_450).sent, true);
  assert.equal(socket.sent.length, 36);
});

class FakeSocket implements VideoPresenceSocketLike {
  bufferedAmount = 0;
  readyState = 0;
  sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
    return true;
  }
}

function createBatch(
  frame: GrayscaleFrame,
  sequence: number,
  publishedAt = 1_000,
) {
  return createVideoPresencePublishBatch({
    frame,
    name: "Ada",
    publishedAt,
    sequence,
  });
}

function makeFrame(
  width: number,
  height: number,
  bits: number,
  fill = 0,
): GrayscaleFrame {
  const byteLength = Math.ceil((width * height * bits) / 8);
  return {
    bits,
    data: Buffer.alloc(byteLength, fill).toString("base64"),
    height,
    width,
  };
}

function makePeers(
  connectionId: string,
  identity: string,
  batch: VideoPresencePublishBatch,
  name = "Ada",
) {
  return new Map([[connectionId, new Map(Object.entries(peerRecord(identity, batch, name)))]]) as VideoPresencePeerState;
}

function peerRecord(
  identity: string,
  batch: VideoPresencePublishBatch,
  name = "Ada",
) {
  return Object.fromEntries([
    ["identity", { name, publicKey: identity }],
    ...batch.messages.map((message) => [message.channel, message.value]),
  ]);
}

function frameFromBatch(batch: VideoPresencePublishBatch) {
  const metadata = parseVideoFrameMetadata(batch.messages.at(-1)?.value);
  assert.ok(metadata);
  const data =
    metadata.data ??
    batch.messages
      .slice(0, -1)
      .map((message) => parseVideoFrameChunk(message.value)?.data ?? "")
      .join("");
  return {
    bits: metadata.bits,
    data,
    height: metadata.height,
    width: metadata.width,
  };
}

function asRecord(value: unknown) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function sentFrameIds(messages: readonly string[]) {
  return messages.flatMap((message) => {
    const parsed = JSON.parse(message) as {
      channel?: unknown;
      value?: unknown;
    };
    if (parsed.channel !== VIDEO_PRESENCE_CHANNEL) return [];
    const metadata = parseVideoFrameMetadata(parsed.value);
    return metadata ? [metadata.frameId] : [];
  });
}

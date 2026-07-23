import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";

import PartySocket from "partysocket";

import {
  applyVideoPresenceServerMessage,
  assembleVideoPresenceParticipants,
  createVideoPresencePublishBatch,
  LatestVideoPresencePublisher,
  parseVideoPresenceServerMessage,
  VIDEO_PRESENCE_CHANNEL,
  VIDEO_PRESENCE_CHUNK_CHANNEL_PREFIX,
  VIDEO_PRESENCE_MAX_HZ,
  VIDEO_PRESENCE_PARTY,
} from "../src/lib/video-presence-protocol.ts";

const PROFILE_DEFAULTS = {
  smoke: {
    churnDowntimeMs: 250,
    churnIntervalSeconds: 0,
    churnSettleMs: 150,
    drainSeconds: 1,
    durationSeconds: 4,
    fps: 4,
    memorySampleMs: 250,
    participants: 4,
  },
  standard: {
    churnDowntimeMs: 1_000,
    churnIntervalSeconds: 10,
    churnSettleMs: 350,
    drainSeconds: 1,
    durationSeconds: 30,
    fps: 10,
    memorySampleMs: 1_000,
    participants: 20,
  },
  soak: {
    churnDowntimeMs: 1_500,
    churnIntervalSeconds: 60,
    churnSettleMs: 500,
    drainSeconds: 2,
    durationSeconds: 15 * 60,
    fps: 10,
    memorySampleMs: 1_000,
    participants: 20,
  },
};

const processMemoryBeforeClients = readProcessMemory();
const config = readConfig(process.argv.slice(2));
const room = encodeURIComponent(
  `telepathy-video-load-test:${Date.now()}:${randomUUID()}`,
);
const EXPECTED_FRAME_RETENTION_MS = 30_000;
const LATENCY_RESERVOIR_SIZE_PER_CLIENT = 5_000;
const expectedRecipientsByFrame = new Map();
let expectedRemoteDeliveries = 0;
let measuring = false;
let measurementStartedAt = null;

const clients = Array.from({ length: config.participants }, (_, index) =>
  createClient(index),
);
const churnStats = {
  attempted: 0,
  completed: 0,
  failures: 0,
  unavailableDurationsMs: [],
};
const memorySamples = [];
const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
let memoryTimer = null;

try {
  await Promise.all(clients.map((client) => client.opened));
  await wait(Math.max(500, config.churnSettleMs));
  for (const client of clients) client.setActive(true);

  const startedAt = performance.now();
  const endsAt = startedAt + config.durationSeconds * 1_000;
  measurementStartedAt = startedAt;
  const cpuStartedAt = process.cpuUsage();
  const wallStartedAt = performance.now();
  sampleProcessMemory(memorySamples, startedAt);
  memoryTimer = setInterval(
    () => sampleProcessMemory(memorySamples, startedAt),
    config.memorySampleMs,
  );
  eventLoopDelay.enable();
  measuring = true;

  await Promise.all([
    ...clients.map((client, index) =>
      publishFrames(client, index, startedAt, endsAt),
    ),
    runChurn(startedAt, endsAt),
  ]);
  const measurementEndedAt = performance.now();
  const activeWallDurationMs = measurementEndedAt - wallStartedAt;
  const cpuUsage = process.cpuUsage(cpuStartedAt);
  await wait(config.drainSeconds * 1_000);
  measuring = false;
  if (memoryTimer !== null) {
    clearInterval(memoryTimer);
    memoryTimer = null;
  }
  eventLoopDelay.disable();
  sampleProcessMemory(memorySamples, startedAt);

  const sentFrames = sum(clients.map((client) => client.sentFrames));
  const receivedFrames = sum(
    clients.map((client) => client.receivedFrames),
  );
  const duplicateFrames = sum(
    clients.map((client) => client.duplicateFrames),
  );
  const activeClientSeconds =
    sum(
      clients.map((client) =>
        client.getActiveDurationMs(measurementEndedAt),
      ),
    ) / 1_000;
  const targetSentFrames = activeClientSeconds * config.fps;
  const achievedSendRatio = targetSentFrames
    ? sentFrames / targetSentFrames
    : 0;
  const deliveryRatio = expectedRemoteDeliveries
    ? receivedFrames / expectedRemoteDeliveries
    : 0;
  const duplicateRatio = expectedRemoteDeliveries
    ? duplicateFrames / expectedRemoteDeliveries
    : 0;
  const latencies = clients.flatMap(
    (client) => client.latencyReservoir.values,
  );
  const observedLatencySamples = sum(
    clients.map((client) => client.latencyReservoir.observed),
  );
  const inboundBytes = sum(clients.map((client) => client.inboundBytes));
  const inboundMessages = sum(
    clients.map((client) => client.inboundMessages),
  );
  const outboundBytes = sum(clients.map((client) => client.outboundBytes));
  const outboundMessages = sum(
    clients.map((client) => client.outboundMessages),
  );
  const identityMissingUpdates = sum(
    clients.map((client) => client.identityMissingUpdates),
  );
  const invalidFrameUpdates = sum(
    clients.map((client) => client.invalidFrameUpdates),
  );
  const unexpectedDeliveries = sum(
    clients.map((client) => client.unexpectedDeliveries),
  );
  const unexpectedDeliveryRatio =
    receivedFrames + unexpectedDeliveries > 0
      ? unexpectedDeliveries / (receivedFrames + unexpectedDeliveries)
      : 0;
  const unexpectedDisconnects = sum(
    clients.map((client) => client.unexpectedDisconnects),
  );
  const unexpectedReconnects = sum(
    clients.map((client) => client.unexpectedReconnects),
  );
  const eventLoopDelaySummary = summarizeEventLoopDelay(eventLoopDelay);
  const memorySummary = summarizeProcessMemory(
    processMemoryBeforeClients,
    memorySamples,
    config.memorySampleMs,
  );
  const latencySummary = {
    ...summarize(latencies),
    observedSamples: observedLatencySamples,
  };
  const churnUnavailableSummary = summarize(
    churnStats.unavailableDurationsMs,
  );
  const result = {
    churn: {
      attempted: churnStats.attempted,
      completed: churnStats.completed,
      failures: churnStats.failures,
      unavailableMs: churnUnavailableSummary,
    },
    config,
    delivery: {
      achievedSendRatio: round(achievedSendRatio),
      activeClientSeconds: round(activeClientSeconds),
      duplicateFrames,
      duplicateRatio: round(duplicateRatio),
      expectedRemoteDeliveries,
      ratio: round(deliveryRatio),
      receivedFrames,
      sentFrames,
      sentFramesPerSecondPerClient: round(
        sentFrames / config.participants / config.durationSeconds,
      ),
      targetSentFrames: round(targetSentFrames),
    },
    diagnostics: {
      identityMissingUpdates,
      invalidFrameUpdates,
      serverRateAdvisories: summarizeServerRateAdvisories(
        clients.flatMap((client) => client.serverRateAdvisories),
      ),
      serverMessageTypes: mergeCountRecords(
        clients.map((client) => client.serverMessageTypes),
      ),
      unexpectedDeliveries,
      unexpectedDeliveryRatio: round(unexpectedDeliveryRatio),
      unexpectedDisconnects,
      unexpectedReconnects,
    },
    eventLoopDelayMs: eventLoopDelaySummary,
    frameData: {
      changesEveryFrame: true,
      generator: "deterministic-xorshift32",
      seed: config.seed,
    },
    latencyMs: latencySummary,
    processCpu: {
      systemMs: round(cpuUsage.system / 1_000),
      totalUtilization: round(
        (cpuUsage.system + cpuUsage.user) / (activeWallDurationMs * 1_000),
      ),
      userMs: round(cpuUsage.user / 1_000),
      wallDurationMs: round(activeWallDurationMs),
    },
    processMemoryBytes: memorySummary,
    room,
    traffic: {
      inboundBytes,
      inboundBytesPerSecondPerClient: round(
        inboundBytes / config.durationSeconds / config.participants,
      ),
      inboundMessages,
      inboundMessagesPerSecondPerClient: round(
        inboundMessages / config.durationSeconds / config.participants,
      ),
      outboundBytes,
      outboundBytesPerSecondPerClient: round(
        outboundBytes / config.durationSeconds / config.participants,
      ),
      outboundMessages,
      outboundMessagesPerSecondPerClient: round(
        outboundMessages / config.durationSeconds / config.participants,
      ),
    },
    version: 2,
  };

  console.log(JSON.stringify(result, null, 2));

  if (
    expectedRemoteDeliveries <= 0 ||
    achievedSendRatio < config.minimumSendRatio ||
    deliveryRatio < config.minimumDeliveryRatio ||
    duplicateRatio > config.maximumDuplicateRatio ||
    (unexpectedDeliveries > config.maximumUnexpectedDeliveries &&
      unexpectedDeliveryRatio > config.maximumUnexpectedDeliveryRatio) ||
    identityMissingUpdates > 0 ||
    invalidFrameUpdates > 0 ||
    unexpectedDisconnects > 0 ||
    unexpectedReconnects > 0 ||
    churnStats.failures > 0 ||
    churnStats.completed !== churnStats.attempted ||
    (churnStats.attempted > 0 &&
      (churnUnavailableSummary.max ?? Infinity) >
        config.maximumChurnUnavailableMs) ||
    (latencySummary.p95 ?? Infinity) > config.maximumLatencyP95Ms ||
    (eventLoopDelaySummary.p95 ?? Infinity) >
      config.maximumEventLoopDelayP95Ms ||
    memorySummary.delta.heapUsed > config.maximumHeapGrowthBytes
  ) {
    process.exitCode = 1;
  }
} finally {
  measuring = false;
  if (memoryTimer !== null) clearInterval(memoryTimer);
  eventLoopDelay.disable();
  for (const client of clients) client.close();
}

function createClient(index) {
  const identityKey = `telepathy-load-${index}-${randomUUID()}`;
  const latestSequenceByIdentity = new Map();
  let activeDurationMs = 0;
  let activeStartedAt = null;
  const client = {
    active: false,
    close: () => {},
    duplicateFrames: 0,
    identityMissingUpdates: 0,
    inboundBytes: 0,
    inboundMessages: 0,
    invalidFrameUpdates: 0,
    getActiveDurationMs: (at) => {
      if (
        !client.active ||
        activeStartedAt === null ||
        measurementStartedAt === null
      ) {
        return activeDurationMs;
      }

      return (
        activeDurationMs +
        Math.max(0, at - Math.max(activeStartedAt, measurementStartedAt))
      );
    },
    latencyReservoir: createReservoir(
      LATENCY_RESERVOIR_SIZE_PER_CLIENT,
      config.seed ^ Math.imul(index + 1, 0x9e3779b1),
    ),
    opened: null,
    outboundBytes: 0,
    outboundMessages: 0,
    publish: () => false,
    receivedFrames: 0,
    restart: async () => null,
    serverRateAdvisories: [],
    serverMessageTypes: {},
    sentFrames: 0,
    setActive: (active) => {
      if (client.active === active) return;
      const changedAt = performance.now();
      if (
        client.active &&
        activeStartedAt !== null &&
        measurementStartedAt !== null
      ) {
        activeDurationMs += Math.max(
          0,
          changedAt - Math.max(activeStartedAt, measurementStartedAt),
        );
      }
      client.active = active;
      activeStartedAt = active ? changedAt : null;
    },
    unexpectedDisconnects: 0,
    unexpectedDeliveries: 0,
    unexpectedReconnects: 0,
  };
  let session = null;
  let sessionGeneration = 0;

  function closeSession() {
    client.setActive(false);
    const closingSession = session;
    session = null;
    sessionGeneration += 1;
    if (!closingSession) return;
    if (closingSession.activeTimer !== null) {
      clearTimeout(closingSession.activeTimer);
    }
    if (closingSession.flushTimer !== null) {
      clearTimeout(closingSession.flushTimer);
    }
    closingSession.socket.close();
  }

  function openSession() {
    const generation = ++sessionGeneration;
    const peers = new Map();
    const socket = new PartySocket({
      host: config.host,
      maxEnqueuedMessages: 0,
      party: VIDEO_PRESENCE_PARTY,
      room,
    });
    const nextSession = {
      activeTimer: null,
      flushTimer: null,
      peers,
      publisher: null,
      socket,
    };
    session = nextSession;

    function recordOutbound(data) {
      if (measuring) {
        client.outboundMessages += 1;
        client.outboundBytes += Buffer.byteLength(data);
      }
    }

    const countedSocket = {
      get bufferedAmount() {
        return socket.bufferedAmount;
      },
      get readyState() {
        return socket.readyState;
      },
      send(data) {
        const sendResult = socket.send(data);
        if (sendResult === false) return false;
        recordOutbound(data);
        if (measuring) {
          try {
            const message = JSON.parse(data);
            if (
              message.type === "presence-update" &&
              message.channel === VIDEO_PRESENCE_CHANNEL
            ) {
              client.sentFrames += 1;
              let expectedRecipientMask = 0;
              for (
                let candidateIndex = 0;
                candidateIndex < clients.length;
                candidateIndex += 1
              ) {
                const candidate = clients[candidateIndex];
                if (candidate !== client && candidate.active) {
                  expectedRecipientMask += 2 ** candidateIndex;
                  expectedRemoteDeliveries += 1;
                }
              }
              if (Number.isSafeInteger(message.value?.sequence)) {
                expectedRecipientsByFrame.set(
                  `${identityKey}:${message.value.sequence}`,
                  {
                    mask: expectedRecipientMask,
                    recordedAt: performance.now(),
                  },
                );
                pruneExpectedFrames(performance.now());
              }
            }
          } catch {
            // Publisher output is JSON; malformed output remains byte-counted.
          }
        }
        return sendResult;
      },
    };
    const publisher = new LatestVideoPresencePublisher(() => countedSocket);
    nextSession.publisher = publisher;

    function scheduleFlush(result) {
      if (
        result.retryAfterMs === null ||
        nextSession.flushTimer !== null ||
        session !== nextSession
      ) {
        return;
      }
      nextSession.flushTimer = setTimeout(() => {
        nextSession.flushTimer = null;
        if (session === nextSession) {
          scheduleFlush(publisher.flush(performance.now()));
        }
      }, result.retryAfterMs);
    }

    socket.addEventListener("message", (event) => {
      if (session !== nextSession || generation !== sessionGeneration) return;

      if (measuring) {
        client.inboundMessages += 1;
        client.inboundBytes += Buffer.byteLength(String(event.data));
      }

      const message = parseVideoPresenceServerMessage(String(event.data));
      if (message) {
        client.serverMessageTypes[message.type] =
          (client.serverMessageTypes[message.type] ?? 0) + 1;
      }
      if (message?.type === "presence-rate") {
        client.serverRateAdvisories.push({
          channel: message.channel,
          hz: message.hz,
        });
        if (
          message.channel === VIDEO_PRESENCE_CHANNEL ||
          message.channel.startsWith(
            VIDEO_PRESENCE_CHUNK_CHANNEL_PREFIX,
          )
        ) {
          publisher.setMaxHz(
            Math.min(VIDEO_PRESENCE_MAX_HZ, message.hz),
          );
        }
        return;
      }
      if (!message || !applyVideoPresenceServerMessage(peers, message)) return;
      if (
        !measuring ||
        !client.active ||
        message.type !== "presence-changes"
      ) {
        return;
      }

      let duplicateUpdates = 0;
      let newFrames = 0;
      for (const [connectionId, values] of Object.entries(message.updates)) {
        if (!(VIDEO_PRESENCE_CHANNEL in values)) continue;
        const peer = peers.get(connectionId);
        const identity = peer?.get("identity");
        const publicKey =
          identity && typeof identity === "object"
            ? identity.publicKey
            : null;
        if (typeof publicKey !== "string") {
          client.identityMissingUpdates += 1;
        }
        if (publicKey === identityKey || !peer) continue;
        const [participant] = assembleVideoPresenceParticipants(
          new Map([[connectionId, peer]]),
          identityKey,
        );
        if (!participant) {
          client.invalidFrameUpdates += 1;
          continue;
        }
        const expectedFrame = expectedRecipientsByFrame.get(
          `${participant.id}:${participant.sequence}`,
        );
        const recipientBit = 2 ** index;
        if (!expectedFrame || (expectedFrame.mask & recipientBit) === 0) {
          client.unexpectedDeliveries += 1;
          continue;
        }
        const latestSequence = latestSequenceByIdentity.get(participant.id);
        if (
          typeof latestSequence === "number" &&
          participant.sequence <= latestSequence
        ) {
          duplicateUpdates += 1;
          continue;
        }
        latestSequenceByIdentity.set(participant.id, participant.sequence);
        newFrames += 1;
        client.receivedFrames += 1;
        client.latencyReservoir.add(
          Math.max(0, Date.now() - participant.publishedAt),
        );
      }
      if (newFrames > 0 || duplicateUpdates > 0) {
        client.duplicateFrames += duplicateUpdates;
      }
    });

    const opened = new Promise((resolve, reject) => {
      let didOpen = false;
      const timeout = setTimeout(
        () => reject(new Error(`Client ${index + 1} timed out`)),
        10_000,
      );

      socket.addEventListener("error", () => {
        if (!didOpen) {
          clearTimeout(timeout);
          reject(new Error(`Client ${index + 1} could not connect`));
        }
      });
      socket.addEventListener("close", () => {
        if (session !== nextSession) return;
        if (measuring) client.unexpectedDisconnects += 1;
        client.setActive(false);
        if (nextSession.activeTimer !== null) {
          clearTimeout(nextSession.activeTimer);
          nextSession.activeTimer = null;
        }
      });
      socket.addEventListener("open", () => {
        if (session !== nextSession) return;
        if (didOpen && measuring) client.unexpectedReconnects += 1;
        if (!didOpen) {
          didOpen = true;
          clearTimeout(timeout);
          resolve();
        }
        const joinMessage = JSON.stringify({
          identity: {
            name: `mock ${index + 1}`,
            playerStyle: { colorPalette: ["#111111"] },
            publicKey: identityKey,
          },
          page: "/load-test",
          type: "presence-join",
        });
        socket.send(joinMessage);
        recordOutbound(joinMessage);
        if (measuring) {
          nextSession.activeTimer = setTimeout(() => {
            nextSession.activeTimer = null;
            if (session === nextSession) client.setActive(true);
          }, config.churnSettleMs);
        }
      });
    });

    client.publish = (batch) => {
      if (!client.active || session !== nextSession) return false;
      scheduleFlush(publisher.submit(batch, performance.now()));
      return true;
    };
    return opened;
  }

  client.opened = openSession();
  client.restart = async (downtimeMs, settleMs) => {
    const unavailableStartedAt = performance.now();
    closeSession();
    await wait(downtimeMs);
    await openSession();
    await wait(settleMs);
    client.setActive(true);
    return performance.now() - unavailableStartedAt;
  };
  client.close = closeSession;
  return client;
}

async function publishFrames(client, clientIndex, startedAt, endsAt) {
  const intervalMs = 1_000 / config.fps;
  let nextAt =
    startedAt + (clientIndex * intervalMs) / config.participants;
  let sequence = 0;
  const byteLength = Math.ceil(
    (config.width * config.height * config.bits) / 8,
  );
  const frameBytes = Buffer.allocUnsafe(byteLength);

  while (nextAt < endsAt) {
    await waitUntil(nextAt);
    sequence += 1;
    const frame = {
      bits: config.bits,
      data: createChangingFrameData(frameBytes, clientIndex, sequence),
      height: config.height,
      width: config.width,
    };
    client.publish(
      createVideoPresencePublishBatch({
        frame,
        name: `mock ${clientIndex + 1}`,
        sequence,
      }),
    );
    nextAt += intervalMs;
  }
}

function createChangingFrameData(bytes, clientIndex, sequence) {
  let state =
    (config.seed ^
      Math.imul(clientIndex + 1, 0x9e3779b1) ^
      Math.imul(sequence, 0x85ebca6b)) >>>
    0;

  for (let index = 0; index < bytes.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }

  return bytes.toString("base64");
}

async function runChurn(startedAt, endsAt) {
  if (config.churnIntervalSeconds <= 0) return;

  const intervalMs = config.churnIntervalSeconds * 1_000;
  const restartBudgetMs = config.churnDowntimeMs + config.churnSettleMs;
  let nextAt = startedAt + intervalMs;
  let targetIndex = 0;

  while (nextAt + restartBudgetMs < endsAt) {
    await waitUntil(nextAt);
    const client = clients[targetIndex % clients.length];
    churnStats.attempted += 1;

    try {
      const unavailableMs = await client.restart(
        config.churnDowntimeMs,
        config.churnSettleMs,
      );
      churnStats.completed += 1;
      churnStats.unavailableDurationsMs.push(unavailableMs);
    } catch (error) {
      churnStats.failures += 1;
      console.error(
        `Client ${(targetIndex % clients.length) + 1} failed to rejoin`,
        error,
      );
    }

    targetIndex += 1;
    nextAt += intervalMs;
  }
}

function readConfig(args) {
  const values = Object.fromEntries(
    args.map((argument) => {
      const [name, value] = argument.replace(/^--/, "").split("=", 2);
      return [name, value];
    }),
  );
  const profile = values.profile ?? "standard";
  const profileDefaults = PROFILE_DEFAULTS[profile];
  if (!profileDefaults) {
    throw new RangeError("profile must be smoke, standard, or soak");
  }

  const churnDowntimeMs = readBounded(
    values["churn-downtime"],
    profileDefaults.churnDowntimeMs,
    0,
    10_000,
    "churn-downtime",
  );
  const churnSettleMs = readBounded(
    values["churn-settle"],
    profileDefaults.churnSettleMs,
    0,
    10_000,
    "churn-settle",
  );

  return {
    bits: readBounded(values.bits, 3, 1, 5, "bits"),
    churnDowntimeMs,
    churnIntervalSeconds: readBounded(
      values["churn-interval"],
      profileDefaults.churnIntervalSeconds,
      0,
      1_800,
      "churn-interval",
    ),
    churnSettleMs,
    drainSeconds: profileDefaults.drainSeconds,
    durationSeconds: readBounded(
      values.duration,
      profileDefaults.durationSeconds,
      1,
      1_800,
      "duration",
    ),
    fps: readBounded(values.fps, profileDefaults.fps, 1, 20, "fps"),
    height: readBounded(values.height, 75, 6, 162, "height"),
    host: values.host || "playhtml.spencerc99.workers.dev",
    maximumDuplicateRatio: readBoundedFloat(
      values["maximum-duplicate-ratio"],
      0.005,
      0,
      1,
      "maximum-duplicate-ratio",
    ),
    maximumChurnUnavailableMs: readBounded(
      values["maximum-churn-unavailable"],
      churnDowntimeMs + churnSettleMs + 3_000,
      0,
      30_000,
      "maximum-churn-unavailable",
    ),
    maximumEventLoopDelayP95Ms: readBoundedFloat(
      values["maximum-event-loop-p95"],
      100,
      0,
      10_000,
      "maximum-event-loop-p95",
    ),
    maximumHeapGrowthBytes: readBounded(
      values["maximum-heap-growth"],
      64 * 1_024 * 1_024,
      0,
      1_024 * 1_024 * 1_024,
      "maximum-heap-growth",
    ),
    maximumLatencyP95Ms: readBoundedFloat(
      values["maximum-latency-p95"],
      500,
      0,
      60_000,
      "maximum-latency-p95",
    ),
    maximumUnexpectedDeliveryRatio: readBoundedFloat(
      values["maximum-unexpected-delivery-ratio"],
      0.005,
      0,
      1,
      "maximum-unexpected-delivery-ratio",
    ),
    maximumUnexpectedDeliveries: readBounded(
      values["maximum-unexpected-deliveries"],
      5,
      0,
      1_000_000,
      "maximum-unexpected-deliveries",
    ),
    memorySampleMs: profileDefaults.memorySampleMs,
    minimumDeliveryRatio: readBoundedFloat(
      values["minimum-delivery-ratio"],
      0.98,
      0,
      1,
      "minimum-delivery-ratio",
    ),
    minimumSendRatio: readBoundedFloat(
      values["minimum-send-ratio"],
      0.95,
      0,
      1,
      "minimum-send-ratio",
    ),
    participants: readBounded(
      values.participants,
      profileDefaults.participants,
      2,
      20,
      "participants",
    ),
    profile,
    seed: readBounded(values.seed, 20_260_722, 0, 0xffffffff, "seed"),
    width: readBounded(values.width, 100, 8, 216, "width"),
  };
}

function readBounded(value, fallback, minimum, maximum, label) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(
      `${label} must be an integer from ${minimum} to ${maximum}`,
    );
  }
  return parsed;
}

function readBoundedFloat(value, fallback, minimum, maximum, label) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new RangeError(
      `${label} must be a number from ${minimum} to ${maximum}`,
    );
  }
  return parsed;
}

function pruneExpectedFrames(now) {
  const cutoff = now - EXPECTED_FRAME_RETENTION_MS;
  for (const [key, frame] of expectedRecipientsByFrame) {
    if (frame.recordedAt > cutoff) break;
    expectedRecipientsByFrame.delete(key);
  }
}

async function waitUntil(target) {
  while (performance.now() < target) {
    await wait(Math.max(0, target - performance.now()));
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sampleProcessMemory(samples, startedAt) {
  samples.push({
    activeClients: clients.filter((client) => client.active).length,
    elapsedMs: performance.now() - startedAt,
    ...readProcessMemory(),
  });
}

function readProcessMemory() {
  const memory = process.memoryUsage();
  return {
    arrayBuffers: memory.arrayBuffers,
    external: memory.external,
    heapTotal: memory.heapTotal,
    heapUsed: memory.heapUsed,
    rss: memory.rss,
  };
}

function summarizeProcessMemory(beforeClients, samples, sampleIntervalMs) {
  const start = samples[0] ?? readProcessMemory();
  const end = samples.at(-1) ?? start;
  const fields = ["arrayBuffers", "external", "heapTotal", "heapUsed", "rss"];
  const delta = {};
  const peak = {};

  for (const field of fields) {
    delta[field] = end[field] - start[field];
    peak[field] = Math.max(...samples.map((sample) => sample[field]));
  }

  return {
    beforeClients,
    delta,
    end: pickMemoryFields(end),
    peak,
    sampleCount: samples.length,
    sampleIntervalMs,
    start: pickMemoryFields(start),
  };
}

function pickMemoryFields(value) {
  return {
    arrayBuffers: value.arrayBuffers,
    external: value.external,
    heapTotal: value.heapTotal,
    heapUsed: value.heapUsed,
    rss: value.rss,
  };
}

function summarizeEventLoopDelay(histogram) {
  return {
    max: nanosecondsToMilliseconds(histogram.max),
    mean: nanosecondsToMilliseconds(histogram.mean),
    p50: nanosecondsToMilliseconds(histogram.percentile(50)),
    p95: nanosecondsToMilliseconds(histogram.percentile(95)),
    p99: nanosecondsToMilliseconds(histogram.percentile(99)),
  };
}

function nanosecondsToMilliseconds(value) {
  return Number.isFinite(value) ? round(value / 1_000_000) : null;
}

function createReservoir(limit, seed) {
  let randomState = (seed >>> 0) || 0x6d2b79f5;
  const reservoir = {
    add(value) {
      reservoir.observed += 1;
      if (reservoir.values.length < limit) {
        reservoir.values.push(value);
        return;
      }

      randomState ^= randomState << 13;
      randomState ^= randomState >>> 17;
      randomState ^= randomState << 5;
      const replacementIndex =
        (randomState >>> 0) % reservoir.observed;
      if (replacementIndex < limit) {
        reservoir.values[replacementIndex] = value;
      }
    },
    observed: 0,
    values: [],
  };
  return reservoir;
}

function summarize(values) {
  if (values.length === 0) {
    return { max: null, p50: null, p95: null, samples: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    max: round(sorted.at(-1)),
    p50: round(sorted[Math.floor((sorted.length - 1) * 0.5)]),
    p95: round(sorted[Math.floor((sorted.length - 1) * 0.95)]),
    samples: sorted.length,
  };
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function mergeCountRecords(records) {
  const merged = {};
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      merged[key] = (merged[key] ?? 0) + value;
    }
  }
  return merged;
}

function summarizeServerRateAdvisories(advisories) {
  const summarized = new Map();

  for (const advisory of advisories) {
    const key = `${advisory.channel}\u0000${advisory.hz}`;
    const existing = summarized.get(key);
    if (existing) {
      existing.messages += 1;
    } else {
      summarized.set(key, { ...advisory, messages: 1 });
    }
  }

  return [...summarized.values()].sort(
    (left, right) =>
      left.channel.localeCompare(right.channel) || left.hz - right.hz,
  );
}

function round(value) {
  return Math.round(value * 1_000) / 1_000;
}

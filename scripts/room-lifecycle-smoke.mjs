import assert from "node:assert/strict";

const args = new Set(process.argv.slice(2));
const waitForExpiry = args.has("--wait-for-expiry");
const baseUrlArgument = process.argv
  .slice(2)
  .find((argument) => argument.startsWith("--base-url="));
const baseUrl = new URL(
  baseUrlArgument?.slice("--base-url=".length) ?? "http://127.0.0.1:3000",
);
const startedAt = Date.now();
const roomName = `Room lifecycle smoke ${startedAt}`;

assert.equal(
  baseUrl.protocol === "http:" || baseUrl.protocol === "https:",
  true,
  "The base URL must use HTTP or HTTPS.",
);

const initialRooms = await getRooms();
assert.equal(
  initialRooms.some((room) => room?.id === "main"),
  true,
  "Main room is missing.",
);

const createResponse = await request("/api/rooms", {
  body: JSON.stringify({ name: roomName }),
  headers: {
    "Content-Type": "application/json",
    "x-vercel-forwarded-for": `room-smoke-${startedAt}`,
  },
  method: "POST",
});
assert.equal(createResponse.status, 201, await describe(createResponse));
const createdBody = await createResponse.json();
assert.equal(typeof createdBody?.room?.id, "string");
const roomId = createdBody.room.id;

const roomsAfterCreate = await getRooms();
assert.equal(
  roomsAfterCreate.some((room) => room?.id === roomId),
  true,
  "The created room is missing from the directory.",
);

const heartbeatResponses = await Promise.all(
  Array.from({ length: 20 }, () =>
    request(`/api/rooms/${encodeURIComponent(roomId)}/heartbeat`, {
      method: "POST",
    }),
  ),
);
assert.deepEqual(
  heartbeatResponses.map((response) => response.status),
  Array(20).fill(204),
  "One or more concurrent heartbeats failed.",
);

const missingId = `missing-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const missingHeartbeat = await request(
  `/api/rooms/${encodeURIComponent(missingId)}/heartbeat`,
  { method: "POST" },
);
assert.equal(missingHeartbeat.status, 410, await describe(missingHeartbeat));

if (waitForExpiry) {
  const expiryWaitMs = 145_000;
  await new Promise((resolve) => setTimeout(resolve, expiryWaitMs));

  const roomsAfterExpiry = await getRooms();
  assert.equal(
    roomsAfterExpiry.some((room) => room?.id === roomId),
    false,
    "The room is still listed after its heartbeat deadline.",
  );

  const expiredHeartbeat = await request(
    `/api/rooms/${encodeURIComponent(roomId)}/heartbeat`,
    { method: "POST" },
  );
  assert.equal(expiredHeartbeat.status, 410, await describe(expiredHeartbeat));

  const expiredPage = await request(`/rooms/${encodeURIComponent(roomId)}`);
  assert.equal(expiredPage.status, 200, await describe(expiredPage));
  assert.match(await expiredPage.text(), /This room has expired\./);
}

process.stdout.write(
  `${JSON.stringify(
    {
      baseUrl: baseUrl.href,
      concurrentHeartbeats: heartbeatResponses.length,
      elapsedMs: Date.now() - startedAt,
      expiryVerified: waitForExpiry,
      roomId,
    },
    null,
    2,
  )}\n`,
);

async function getRooms() {
  const response = await request("/api/rooms");
  assert.equal(response.status, 200, await describe(response));
  const body = await response.json();
  assert.equal(Array.isArray(body?.rooms), true, "Room list is not an array.");
  return body.rooms;
}

async function request(pathname, init) {
  return fetch(new URL(pathname, baseUrl), {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
}

async function describe(response) {
  let body = "";
  try {
    body = await response.clone().text();
  } catch {
    // The status is enough when a response body cannot be read.
  }
  return `${response.status} ${response.statusText}${body ? `: ${body}` : ""}`;
}

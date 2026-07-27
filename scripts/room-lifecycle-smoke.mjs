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

await waitForRoomListing(roomId, true);

const participantIds = Array.from({ length: 21 }, () =>
  crypto.randomUUID().replaceAll("-", ""),
);
const admissionResponses = await Promise.all(
  participantIds.slice(0, 20).map((participantId) =>
    request(`/api/rooms/${encodeURIComponent(roomId)}/participants`, {
      body: JSON.stringify({ participantId }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  ),
);
assert.deepEqual(
  admissionResponses.map((response) => response.status),
  Array(20).fill(200),
  "One or more concurrent participant admissions failed.",
);

const duplicateAdmission = await admitParticipant(
  roomId,
  participantIds[0],
);
assert.equal(duplicateAdmission.status, 200, await describe(duplicateAdmission));
assert.equal((await duplicateAdmission.json()).participantCount, 20);

const fullAdmission = await admitParticipant(roomId, participantIds[20]);
assert.equal(fullAdmission.status, 409, await describe(fullAdmission));
assert.equal((await fullAdmission.json()).participantCount, 20);
await waitForParticipantCount(roomId, 20);

const participantCountResponse = await request(
  `/api/rooms/${encodeURIComponent(roomId)}/participants`,
);
assert.equal(
  participantCountResponse.status,
  200,
  await describe(participantCountResponse),
);
assert.equal((await participantCountResponse.json()).participantCount, 20);

const leaveResponse = await request(
  `/api/rooms/${encodeURIComponent(roomId)}/participants`,
  {
    body: JSON.stringify({ participantId: participantIds[0] }),
    headers: { "Content-Type": "application/json" },
    method: "DELETE",
  },
);
assert.equal(leaveResponse.status, 200, await describe(leaveResponse));
assert.equal((await leaveResponse.json()).participantCount, 19);

const replacementAdmission = await admitParticipant(
  roomId,
  participantIds[20],
);
assert.equal(
  replacementAdmission.status,
  200,
  await describe(replacementAdmission),
);
assert.equal((await replacementAdmission.json()).participantCount, 20);

const missingId = `missing-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const missingCount = await request(
  `/api/rooms/${encodeURIComponent(missingId)}/participants`,
);
assert.equal(missingCount.status, 410, await describe(missingCount));

if (waitForExpiry) {
  const expiryWaitMs = 145_000;
  await new Promise((resolve) => setTimeout(resolve, expiryWaitMs));

  await waitForRoomListing(roomId, false);

  const expiredCount = await request(
    `/api/rooms/${encodeURIComponent(roomId)}/participants`,
  );
  assert.equal(expiredCount.status, 410, await describe(expiredCount));

  const expiredPage = await request(`/rooms/${encodeURIComponent(roomId)}`);
  assert.equal(expiredPage.status, 200, await describe(expiredPage));
  assert.match(await expiredPage.text(), /This room has expired\./);
}

process.stdout.write(
  `${JSON.stringify(
    {
      baseUrl: baseUrl.href,
      concurrentAdmissions: admissionResponses.length,
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

async function waitForRoomListing(roomId, shouldBePresent) {
  const timeoutAt = Date.now() + 12_000;

  while (Date.now() < timeoutAt) {
    const rooms = await getRooms();
    if (
      rooms.some((room) => room?.id === roomId) === shouldBePresent
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  assert.fail(
    shouldBePresent
      ? "The created room is missing from the directory."
      : "The expired room is still in the directory.",
  );
}

async function waitForParticipantCount(roomId, participantCount) {
  const timeoutAt = Date.now() + 12_000;

  while (Date.now() < timeoutAt) {
    const rooms = await getRooms();
    const room = rooms.find((candidate) => candidate?.id === roomId);
    if (room?.participantCount === participantCount) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  assert.fail(`The room directory did not show ${participantCount} participants.`);
}

function admitParticipant(roomId, participantId) {
  return request(`/api/rooms/${encodeURIComponent(roomId)}/participants`, {
    body: JSON.stringify({ participantId }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
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

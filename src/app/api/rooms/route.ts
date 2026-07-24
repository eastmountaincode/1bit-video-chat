import { createHash } from "node:crypto";

import { MAIN_ROOM } from "@/lib/room-directory";
import {
  createRegisteredRoom,
  listPublicRooms,
  RoomRegistryCapacityError,
  RoomRegistryRateLimitError,
  RoomRegistryUnavailableError,
} from "@/lib/redis-room-registry";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};
const ROOM_LIST_HEADERS = {
  "Cache-Control": "public, max-age=0, must-revalidate",
  "Vercel-CDN-Cache-Control": "public, max-age=5",
};
const ROOM_CREATE_BODY_LIMIT = 1_024;

export async function GET() {
  try {
    const rooms = await listPublicRooms();
    return Response.json({ rooms }, { headers: ROOM_LIST_HEADERS });
  } catch (error) {
    if (!(error instanceof RoomRegistryUnavailableError)) {
      console.error("Could not load the room list.", error);
    }
    return Response.json(
      {
        error: "New rooms are temporarily unavailable.",
        rooms: [MAIN_ROOM],
      },
      { headers: NO_STORE_HEADERS, status: 503 },
    );
  }
}

export async function POST(request: Request) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return invalidRoomNameResponse();
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > ROOM_CREATE_BODY_LIMIT
  ) {
    return oversizedRoomNameResponse();
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return invalidRoomNameResponse();
  }
  if (rawBody.length > ROOM_CREATE_BODY_LIMIT) {
    return oversizedRoomNameResponse();
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return invalidRoomNameResponse();
  }

  const name =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).name
      : null;

  try {
    const room = await createRegisteredRoom(
      name,
      getClientRateLimitId(request),
    );
    return Response.json(
      { room },
      { headers: NO_STORE_HEADERS, status: 201 },
    );
  } catch (error) {
    if (error instanceof TypeError) {
      return Response.json(
        { error: error.message },
        { headers: NO_STORE_HEADERS, status: 400 },
      );
    }
    if (error instanceof RoomRegistryCapacityError) {
      return Response.json(
        { error: error.message },
        { headers: NO_STORE_HEADERS, status: 409 },
      );
    }
    if (error instanceof RoomRegistryRateLimitError) {
      return Response.json(
        { error: error.message },
        { headers: NO_STORE_HEADERS, status: 429 },
      );
    }

    console.error("Could not create the room.", error);
    return Response.json(
      { error: "The room could not be created." },
      { headers: NO_STORE_HEADERS, status: 503 },
    );
  }
}

function getClientRateLimitId(request: Request): string {
  const forwardedFor =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for") ??
    "unknown";
  const address = forwardedFor.split(",", 1)[0].trim().slice(0, 128);

  return createHash("sha256").update(address).digest("hex").slice(0, 32);
}

function invalidRoomNameResponse(): Response {
  return Response.json(
    { error: "Enter a room name." },
    { headers: NO_STORE_HEADERS, status: 400 },
  );
}

function oversizedRoomNameResponse(): Response {
  return Response.json(
    { error: "The room name is too long." },
    { headers: NO_STORE_HEADERS, status: 413 },
  );
}

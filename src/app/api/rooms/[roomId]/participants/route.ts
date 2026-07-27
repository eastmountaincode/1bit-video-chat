import { isValidRoomId, ROOM_PARTICIPANT_CAPACITY } from "@/lib/room-directory";
import { isValidRoomParticipantId } from "@/lib/room-lifecycle";
import {
  admitRegisteredRoomParticipant,
  getRegisteredRoomParticipantCount,
  leaveRegisteredRoomParticipant,
  RoomParticipantCapacityError,
  RoomRegistryUnavailableError,
} from "@/lib/redis-room-registry";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};
const PARTICIPANT_BODY_LIMIT = 256;

interface ParticipantRouteContext {
  params: Promise<{ roomId: string }>;
}

export async function GET(
  _request: Request,
  { params }: ParticipantRouteContext,
) {
  const roomId = await readRoomId(params);
  if (!roomId) return expiredRoomResponse();

  try {
    const participantCount =
      await getRegisteredRoomParticipantCount(roomId);
    if (participantCount === null) return expiredRoomResponse();
    return participantCountResponse(participantCount);
  } catch (error) {
    return unavailableResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: ParticipantRouteContext,
) {
  const roomId = await readRoomId(params);
  if (!roomId) return expiredRoomResponse();

  const participantId = await readParticipantId(request);
  if (!participantId) return invalidParticipantResponse();

  try {
    const participantCount = await admitRegisteredRoomParticipant(
      roomId,
      participantId,
    );
    if (participantCount === null) return expiredRoomResponse();
    return participantCountResponse(participantCount);
  } catch (error) {
    if (error instanceof RoomParticipantCapacityError) {
      return Response.json(
        {
          capacity: ROOM_PARTICIPANT_CAPACITY,
          error: error.message,
          participantCount: error.participantCount,
        },
        { headers: NO_STORE_HEADERS, status: 409 },
      );
    }
    return unavailableResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: ParticipantRouteContext,
) {
  const roomId = await readRoomId(params);
  if (!roomId) return invalidParticipantResponse();

  const participantId = await readParticipantId(request);
  if (!participantId) return invalidParticipantResponse();

  try {
    const participantCount = await leaveRegisteredRoomParticipant(
      roomId,
      participantId,
    );
    return participantCountResponse(participantCount);
  } catch (error) {
    return unavailableResponse(error);
  }
}

async function readRoomId(
  params: Promise<{ roomId: string }>,
): Promise<string | null> {
  const { roomId } = await params;
  return isValidRoomId(roomId) ? roomId : null;
}

async function readParticipantId(request: Request): Promise<string | null> {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return null;
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > PARTICIPANT_BODY_LIMIT
  ) {
    return null;
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return null;
  }
  if (rawBody.length > PARTICIPANT_BODY_LIMIT) return null;

  try {
    const body: unknown = JSON.parse(rawBody);
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }
    const participantId = (body as Record<string, unknown>).participantId;
    return isValidRoomParticipantId(participantId) ? participantId : null;
  } catch {
    return null;
  }
}

function participantCountResponse(participantCount: number): Response {
  return Response.json(
    {
      capacity: ROOM_PARTICIPANT_CAPACITY,
      participantCount,
    },
    { headers: NO_STORE_HEADERS },
  );
}

function invalidParticipantResponse(): Response {
  return Response.json(
    { error: "Invalid room participant." },
    { headers: NO_STORE_HEADERS, status: 400 },
  );
}

function expiredRoomResponse(): Response {
  return Response.json(
    { error: "This room has expired." },
    { headers: NO_STORE_HEADERS, status: 410 },
  );
}

function unavailableResponse(error: unknown): Response {
  if (!(error instanceof RoomRegistryUnavailableError)) {
    console.error("Could not update the room participant list.", error);
  }
  return Response.json(
    { error: "The room server is unavailable." },
    { headers: NO_STORE_HEADERS, status: 503 },
  );
}

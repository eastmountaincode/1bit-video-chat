import { isValidRoomId } from "@/lib/room-directory";
import {
  heartbeatRegisteredRoom,
  RoomRegistryUnavailableError,
} from "@/lib/redis-room-registry";

export const dynamic = "force-dynamic";

interface HeartbeatRouteContext {
  params: Promise<{ roomId: string }>;
}

export async function POST(
  _request: Request,
  { params }: HeartbeatRouteContext,
) {
  const { roomId } = await params;
  if (!isValidRoomId(roomId)) {
    return Response.json(
      { error: "This room has expired." },
      { headers: { "Cache-Control": "no-store" }, status: 410 },
    );
  }

  try {
    const active = await heartbeatRegisteredRoom(roomId);
    if (!active) {
      return Response.json(
        { error: "This room has expired." },
        { headers: { "Cache-Control": "no-store" }, status: 410 },
      );
    }

    return new Response(null, {
      headers: { "Cache-Control": "no-store" },
      status: 204,
    });
  } catch (error) {
    if (!(error instanceof RoomRegistryUnavailableError)) {
      console.error("Could not renew the room.", error);
    }
    return Response.json(
      { error: "The room server is unavailable." },
      { headers: { "Cache-Control": "no-store" }, status: 503 },
    );
  }
}

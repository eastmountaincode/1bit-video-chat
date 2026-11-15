import {
  createPublicRoomListing,
  MAIN_ROOM,
} from "@/lib/room-directory";
import {
  listPublicRooms,
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
        error: "Could not refresh rooms.",
        rooms: [createPublicRoomListing(MAIN_ROOM, 0)],
      },
      { headers: NO_STORE_HEADERS, status: 503 },
    );
  }
}

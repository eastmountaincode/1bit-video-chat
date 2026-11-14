import { ADMIN_HEADERS, adminError, isAdminAuthenticated } from "@/lib/admin-auth";
import { isSameOriginRequest } from "@/lib/admin-session";
import { isValidRoomId, MAIN_ROOM } from "@/lib/room-directory";
import { deleteRegisteredRoom } from "@/lib/redis-room-registry";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
    if (!await isAdminAuthenticated()) return adminError("Please sign in.", 401);
    if (!isSameOriginRequest(request)) return adminError("Invalid request origin.", 403);
    const { roomId } = await params;
    if (!isValidRoomId(roomId)) return adminError("Invalid room.", 400);
    if (roomId === MAIN_ROOM.id) return adminError("The Main room cannot be deleted.", 403);
    try {
        await deleteRegisteredRoom(roomId);
        return Response.json({ ok: true }, { headers: ADMIN_HEADERS });
    } catch {
        return adminError("Could not delete this room. Try again.", 503);
    }
}

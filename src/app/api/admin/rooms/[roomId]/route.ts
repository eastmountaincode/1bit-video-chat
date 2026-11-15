import { ADMIN_HEADERS, adminError, isAdminAuthenticated, readAdminRoomName } from "@/lib/admin-auth";
import { isSameOriginRequest } from "@/lib/admin-session";
import { isValidRoomId, MAIN_ROOM } from "@/lib/room-directory";
import { deleteRegisteredRoom, renameRegisteredRoom } from "@/lib/redis-room-registry";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
    if (!await isAdminAuthenticated()) return adminError("Please sign in.", 401);
    if (!isSameOriginRequest(request)) return adminError("Invalid request origin.", 403);
    const { roomId } = await params;
    if (!isValidRoomId(roomId)) return adminError("Invalid room.", 400);
    const name = await readAdminRoomName(request);
    if (name instanceof Response) return name;
    try {
        const room = await renameRegisteredRoom(roomId, name);
        if (!room) return adminError("Room not found.", 404);
        return Response.json({ room }, { headers: ADMIN_HEADERS });
    } catch {
        return adminError("Could not rename the room.", 503);
    }
}

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

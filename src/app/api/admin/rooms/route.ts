import { ADMIN_HEADERS, adminError, isAdminAuthenticated } from "@/lib/admin-auth";
import { isSameOriginRequest } from "@/lib/admin-session";
import { isValidRoomId, MAIN_ROOM, MAX_PUBLIC_ROOMS } from "@/lib/room-directory";
import { deleteRegisteredRooms, listPublicRooms } from "@/lib/redis-room-registry";

export const dynamic = "force-dynamic";

export async function GET() {
    if (!await isAdminAuthenticated()) return adminError("Please sign in.", 401);
    try {
        const rooms = await listPublicRooms();
        return Response.json({ rooms }, { headers: ADMIN_HEADERS });
    } catch {
        return adminError("Could not load rooms. Try again.", 503);
    }
}

export async function DELETE(request: Request) {
    if (!await isAdminAuthenticated()) return adminError("Please sign in.", 401);
    if (!isSameOriginRequest(request)) return adminError("Invalid request origin.", 403);
    const body = await request.json().catch(() => null);
    const ids: unknown = body?.roomIds;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length >= MAX_PUBLIC_ROOMS ||
        new Set(ids).size !== ids.length || ids.some((id) => !isValidRoomId(id) || id === MAIN_ROOM.id)) {
        return adminError("Invalid rooms to delete.", 400);
    }
    try {
        const deleted = await deleteRegisteredRooms(ids);
        return Response.json({ deleted }, { headers: ADMIN_HEADERS });
    } catch {
        return adminError("Could not delete rooms. Try again.", 503);
    }
}

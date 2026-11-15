import { ADMIN_HEADERS, adminError, isAdminAuthenticated } from "@/lib/admin-auth";
import { isSameOriginRequest } from "@/lib/admin-session";
import { isValidRoomId } from "@/lib/room-directory";
import { getPublicRoom } from "@/lib/redis-room-registry";
import { resetRoomCss } from "@/lib/reset-room-css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
    if (!await isAdminAuthenticated()) return adminError("Please sign in.", 401);
    if (!isSameOriginRequest(request)) return adminError("Invalid request origin.", 403);
    const { roomId } = await params;
    if (!isValidRoomId(roomId)) return adminError("Invalid room.", 400);
    try {
        if (!await getPublicRoom(roomId)) return adminError("Room not found.", 404);
        await resetRoomCss(roomId, new URL(request.url));
        return Response.json({ ok: true }, { headers: ADMIN_HEADERS });
    } catch (error) {
        console.error("Could not reset room CSS.", error);
        return adminError("Could not reset CSS.", 503);
    }
}

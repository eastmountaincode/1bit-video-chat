import { ADMIN_HEADERS, adminError, isAdminAuthenticated } from "@/lib/admin-auth";
import { listPublicRooms } from "@/lib/redis-room-registry";

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

import { createHash } from "node:crypto";
import { ADMIN_HEADERS, adminError, isAdminAuthenticated, readAdminRoomName } from "@/lib/admin-auth";
import { isSameOriginRequest } from "@/lib/admin-session";
import { isValidRoomId, MAIN_ROOM, MAX_PUBLIC_ROOMS } from "@/lib/room-directory";
import {
    createRegisteredRoom, deleteRegisteredRooms, listPublicRooms,
    RoomRegistryCapacityError, RoomRegistryRateLimitError,
} from "@/lib/redis-room-registry";

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

export async function POST(request: Request) {
    if (!await isAdminAuthenticated()) return adminError("Please sign in.", 401);
    if (!isSameOriginRequest(request)) return adminError("Invalid request origin.", 403);
    const name = await readAdminRoomName(request);
    if (name instanceof Response) return name;
    const address = (request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for") ?? "unknown")
        .split(",", 1)[0].trim().slice(0, 128);
    const rateLimitId = createHash("sha256").update(address).digest("hex").slice(0, 32);
    try {
        const room = await createRegisteredRoom(name, rateLimitId);
        return Response.json({ room }, { headers: ADMIN_HEADERS, status: 201 });
    } catch (error) {
        if (error instanceof TypeError) return adminError(error.message, 400);
        if (error instanceof RoomRegistryCapacityError) return adminError(error.message, 409);
        if (error instanceof RoomRegistryRateLimitError) return adminError(error.message, 429);
        console.error("Could not create the room.", error);
        return adminError("Could not create the room.", 503);
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

import "server-only";

import { cookies } from "next/headers";

import { ADMIN_COOKIE_NAME, verifyAdminSession } from "@/lib/admin-session";
import { normalizeRoomName } from "@/lib/room-directory";

export const ADMIN_HEADERS = {
    "Cache-Control": "private, no-store",
    "Vary": "Cookie",
    "X-Robots-Tag": "noindex, nofollow",
};

export async function isAdminAuthenticated(): Promise<boolean> {
    const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
    return verifyAdminSession(token, process.env.TELEPATHY_ADMIN_PASSWORD);
}

export function adminError(message: string, status: number): Response {
    return Response.json({ error: message }, { headers: ADMIN_HEADERS, status });
}

export async function readAdminRoomName(request: Request): Promise<string | Response> {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        return adminError("Enter a room name.", 400);
    }
    const reader = request.body?.getReader();
    if (!reader) return adminError("Enter a room name.", 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 1024) {
                await reader.cancel();
                return adminError("The room name is too long.", 413);
            }
            chunks.push(value);
        }
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const name = normalizeRoomName(body && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>).name : null);
        return name || adminError("Enter a room name.", 400);
    } catch {
        return adminError("Enter a room name.", 400);
    } finally {
        reader.releaseLock();
    }
}

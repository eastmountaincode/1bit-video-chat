import "server-only";

import { cookies } from "next/headers";

import { ADMIN_COOKIE_NAME, verifyAdminSession } from "@/lib/admin-session";

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

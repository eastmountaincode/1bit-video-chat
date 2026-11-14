import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

import { ADMIN_HEADERS, adminError } from "@/lib/admin-auth";
import {
    ADMIN_COOKIE_NAME,
    ADMIN_SESSION_SECONDS,
    createAdminSession,
    isAdminPasswordConfigured,
    isSameOriginRequest,
    matchesAdminPassword,
} from "@/lib/admin-session";
import { allowAdminLoginAttempt } from "@/lib/redis-room-registry";

export const dynamic = "force-dynamic";

const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
};

export async function POST(request: Request) {
    if (!isSameOriginRequest(request)) return adminError("Invalid request origin.", 403);
    const password = process.env.TELEPATHY_ADMIN_PASSWORD;
    if (!isAdminPasswordConfigured(password)) return adminError("Admin access is not configured.", 503);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        return adminError("Invalid sign-in request.", 400);
    }

    try {
        const address = (request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for") ?? "unknown")
            .split(",", 1)[0].trim().slice(0, 128);
        const rateLimitId = createHash("sha256").update(address).digest("hex");
        if (!await allowAdminLoginAttempt(rateLimitId)) {
            return Response.json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, {
                headers: { ...ADMIN_HEADERS, "Retry-After": "900" },
                status: 429,
            });
        }

        // Bound the body as it is read, including chunked requests without Content-Length.
        const reader = request.body?.getReader();
        if (!reader) return adminError("Enter your password.", 400);
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 2048) {
                await reader.cancel();
                return adminError("Sign-in request is too large.", 413);
            }
            chunks.push(value);
        }
        let body: unknown;
        try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
            return adminError("Invalid sign-in request.", 400);
        }
        const candidate = body && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>).password : null;
        if (!matchesAdminPassword(candidate, password)) return adminError("Incorrect password.", 401);

        const response = NextResponse.json({ ok: true }, { headers: ADMIN_HEADERS });
        response.cookies.set(ADMIN_COOKIE_NAME, createAdminSession(password), {
            ...COOKIE_OPTIONS,
            maxAge: ADMIN_SESSION_SECONDS,
        });
        return response;
    } catch {
        return adminError("Sign-in is temporarily unavailable. Try again.", 503);
    }
}

export async function DELETE(request: Request) {
    if (!isSameOriginRequest(request)) return adminError("Invalid request origin.", 403);
    const response = NextResponse.json({ ok: true }, { headers: ADMIN_HEADERS });
    response.cookies.set(ADMIN_COOKIE_NAME, "", { ...COOKIE_OPTIONS, maxAge: 0 });
    return response;
}

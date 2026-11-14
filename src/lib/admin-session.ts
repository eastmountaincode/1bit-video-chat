import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_SECONDS = 12 * 60 * 60;
export const ADMIN_COOKIE_NAME = "telepathy-admin";

export function isAdminPasswordConfigured(password: unknown): password is string {
    return typeof password === "string" && password.length >= 24 && password.length <= 256;
}

export function matchesAdminPassword(candidate: unknown, password: string): boolean {
    if (!isAdminPasswordConfigured(password) || typeof candidate !== "string" || candidate.length > 256) {
        return false;
    }
    return timingSafeEqual(digest(candidate), digest(password));
}

export function createAdminSession(password: string, now = Date.now()): string {
    if (!isAdminPasswordConfigured(password)) throw new Error("Admin password is not configured.");
    const payload = `${Math.floor(now / 1000) + ADMIN_SESSION_SECONDS}.${randomBytes(24).toString("hex")}`;
    return `${payload}.${signature(payload, password)}`;
}

export function verifyAdminSession(token: unknown, password: unknown, now = Date.now()): boolean {
    if (!isAdminPasswordConfigured(password) || typeof token !== "string" || token.length > 200) return false;
    const match = /^(\d{10})\.([a-f0-9]{48})\.([a-f0-9]{64})$/.exec(token);
    if (!match) return false;
    const expiresAt = Number(match[1]);
    const currentTime = Math.floor(now / 1000);
    if (expiresAt <= currentTime || expiresAt > currentTime + ADMIN_SESSION_SECONDS) return false;
    return timingSafeEqual(
        Buffer.from(match[3], "hex"),
        Buffer.from(signature(`${match[1]}.${match[2]}`, password), "hex"),
    );
}

export function isSameOriginRequest(request: Request): boolean {
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    return origin === new URL(request.url).origin && (!site || site === "same-origin");
}

function digest(value: string): Buffer {
    return createHash("sha256").update(value).digest();
}

function signature(payload: string, password: string): string {
    return createHmac("sha256", password).update(`telepathy-admin:v1:${payload}`).digest("hex");
}

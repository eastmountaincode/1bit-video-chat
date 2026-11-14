import assert from "node:assert/strict";
import test from "node:test";

import {
    ADMIN_SESSION_SECONDS,
    createAdminSession,
    isAdminPasswordConfigured,
    isSameOriginRequest,
    matchesAdminPassword,
    verifyAdminSession,
} from "./admin-session.ts";

const password = "test-password";
const now = 1_800_000_000_000;

test("admin access accepts short passwords but rejects missing or invalid configuration", () => {
    for (const value of [undefined, null, 123, "", "x".repeat(257)]) {
        assert.equal(isAdminPasswordConfigured(value), false);
        assert.equal(verifyAdminSession("anything", value, now), false);
    }
    assert.throws(() => createAdminSession(""));
    for (const value of ["x", "short", "x".repeat(23), "x".repeat(24), "x".repeat(256)]) {
        assert.equal(isAdminPasswordConfigured(value), true);
        assert.equal(matchesAdminPassword(value, value), true);
        assert.equal(verifyAdminSession(createAdminSession(value, now), value, now), true);
    }
    assert.equal(matchesAdminPassword(password, password), true);
    assert.equal(matchesAdminPassword(`${password}x`, password), false);
    assert.equal(matchesAdminPassword(null, password), false);
});

test("signed sessions expire and password rotation invalidates existing sessions", () => {
    const token = createAdminSession(password, now);
    assert.equal(verifyAdminSession(token, password, now), true);
    assert.equal(verifyAdminSession(token, password, now + ADMIN_SESSION_SECONDS * 1000 - 1), true);
    assert.equal(verifyAdminSession(token, password, now + ADMIN_SESSION_SECONDS * 1000), false);
    assert.equal(verifyAdminSession(token, `${password}-rotated`, now), false);
    assert.equal(verifyAdminSession(token, password, now - 1000), false);
    assert.notEqual(createAdminSession(password, now), token);
});

test("rejects forged, modified and malformed sessions", () => {
    const token = createAdminSession(password, now);
    const [expiry, nonce, signature] = token.split(".");
    for (const invalid of [
        undefined, "", `${Number(expiry) + 1}.${nonce}.${signature}`,
        `${expiry}.${"0".repeat(48)}.${signature}`, `${expiry}.${nonce}.${"0".repeat(64)}`,
        `${token}.extra`, token.slice(0, -1), "x".repeat(1000),
    ]) assert.equal(verifyAdminSession(invalid, password, now), false);
});

test("mutations require the same origin and reject cross-site requests", () => {
    const request = (headers: Record<string, string>) => new Request("https://telepathy.example/api/admin/session", { headers });
    assert.equal(isSameOriginRequest(request({ origin: "https://telepathy.example" })), true);
    assert.equal(isSameOriginRequest(request({ origin: "https://telepathy.example", "sec-fetch-site": "same-origin" })), true);
    assert.equal(isSameOriginRequest(request({ origin: "https://evil.example" })), false);
    assert.equal(isSameOriginRequest(request({ origin: "https://telepathy.example", "sec-fetch-site": "cross-site" })), false);
    assert.equal(isSameOriginRequest(request({})), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import { getMobileChatViewport } from "./mobile-chat-viewport.ts";

test("mobile chat follows the visible bottom edge through keyboard opening, panning and closing", () => {
    assert.deepEqual(getMobileChatViewport(844, { height: 844, offsetTop: 0 }), { height: 844, bottomEdge: 844 });
    assert.deepEqual(getMobileChatViewport(844, { height: 460, offsetTop: 0 }), { height: 460, bottomEdge: 460 });
    assert.deepEqual(getMobileChatViewport(844, { height: 460, offsetTop: 90 }), { height: 460, bottomEdge: 550 });
    assert.deepEqual(getMobileChatViewport(844, { height: 844, offsetTop: 0 }), { height: 844, bottomEdge: 844 });
});

test("window height and Safari toolbar changes cannot add an extra keyboard offset", () => {
    for (const windowHeight of [390, 460, 766, 844, 922]) {
        assert.deepEqual(getMobileChatViewport(windowHeight, { height: 460, offsetTop: 0 }), {
            height: 460,
            bottomEdge: 460,
        });
        assert.deepEqual(getMobileChatViewport(windowHeight, { height: 460, offsetTop: 90 }), {
            height: 460,
            bottomEdge: 550,
        });
    }
});

test("mobile chat falls back to window height without VisualViewport", () => {
    assert.deepEqual(getMobileChatViewport(460), { height: 460, bottomEdge: 460 });
    assert.deepEqual(getMobileChatViewport(844, null), { height: 844, bottomEdge: 844 });
    assert.deepEqual(getMobileChatViewport(390, { height: 450, offsetTop: -20 }), { height: 450, bottomEdge: 450 });
});

import assert from "node:assert/strict";
import test from "node:test";

import { getMobileChatViewport } from "./mobile-chat-viewport.ts";

test("mobile chat stays above a keyboard that only shrinks the visible viewport", () => {
    assert.deepEqual(getMobileChatViewport(844, { height: 844, offsetTop: 0 }), { height: 844, bottom: 0 });
    assert.deepEqual(getMobileChatViewport(844, { height: 460, offsetTop: 0 }), { height: 460, bottom: 384 });
    assert.deepEqual(getMobileChatViewport(844, { height: 460, offsetTop: 90 }), { height: 460, bottom: 294 });
    assert.deepEqual(getMobileChatViewport(844, { height: 844, offsetTop: 0 }), { height: 844, bottom: 0 });
});

test("mobile chat also handles browsers that resize the layout or lack VisualViewport", () => {
    assert.deepEqual(getMobileChatViewport(460, { height: 460, offsetTop: 0 }), { height: 460, bottom: 0 });
    assert.deepEqual(getMobileChatViewport(460), { height: 460, bottom: 0 });
    assert.deepEqual(getMobileChatViewport(390, { height: 450, offsetTop: -20 }), { height: 390, bottom: 0 });
});

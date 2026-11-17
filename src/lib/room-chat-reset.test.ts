import assert from "node:assert/strict";
import test from "node:test";
import { syncedStore } from "@syncedstore/core";
import * as Y from "yjs";

import { clearSharedRoomChat, getSharedRoomChatResetId } from "./room-chat-reset.ts";
import type { ChatLedger } from "./shared-types.ts";

function makeRoom() {
    const document = new Y.Doc();
    const store = syncedStore({ play: {} as Record<string, Record<string, unknown>> }, document);
    store.play.__page__ = {
        "global-chat:v1": { messages: [{ id: "old", author: "ab", text: "old message", sentAt: 1 }], version: 1 },
        "room-style:v3": { current: { id: "keep-css", entries: [] }, version: 1 },
        "room-hydra:v1": { code: "osc().out()", enabled: true, version: 1 },
        "room-hydra-code:v1": { current: { id: "keep-draft", entries: [] }, version: 1 },
    };
    return { document, store };
}

test("clear chat reaches another client, preserves room settings, and accepts new attributed messages", () => {
    const writer = makeRoom();
    const reader = new Y.Doc();
    const readerStore = syncedStore({ play: {} as Record<string, Record<string, unknown>> }, reader);
    Y.applyUpdate(reader, Y.encodeStateAsUpdate(writer.document));
    const before = reader.getMap("play").toJSON().__page__;
    clearSharedRoomChat(writer.document, "clear-1", 1000);
    Y.applyUpdate(reader, Y.encodeStateAsUpdate(writer.document));
    assert.equal(getSharedRoomChatResetId(reader), "clear-1");
    const page = reader.getMap("play").toJSON().__page__;
    assert.deepEqual(page["global-chat:v1"].messages, []);
    for (const key of ["room-style:v3", "room-hydra:v1", "room-hydra-code:v1"]) {
        assert.deepEqual(page[key], before[key]);
    }
    const chat = readerStore.play.__page__["global-chat:v1"] as ChatLedger;
    chat.messages.push({ id: "new", author: "ab", authorId: "p-123", text: "new message", sentAt: 1001 });
    Y.applyUpdate(writer.document, Y.encodeStateAsUpdate(reader));
    const saved = writer.document.getMap("play").toJSON().__page__["global-chat:v1"].messages;
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, "new");
    assert.equal(saved[0].authorId, "p-123");
    writer.document.destroy();
    reader.destroy();
});

test("an offline client cannot restore the cleared history by editing its old message array", () => {
    const writer = makeRoom();
    const offline = new Y.Doc();
    const offlineStore = syncedStore({ play: {} as Record<string, Record<string, unknown>> }, offline);
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(writer.document));
    const oldChat = offlineStore.play.__page__["global-chat:v1"] as ChatLedger;
    oldChat.messages.push({ id: "stale", author: "ab", text: "offline edit", sentAt: 2 });
    clearSharedRoomChat(writer.document, "clear-2", 1000);
    Y.applyUpdate(writer.document, Y.encodeStateAsUpdate(offline));
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(writer.document));
    for (const document of [writer.document, offline]) {
        assert.equal(getSharedRoomChatResetId(document), "clear-2");
        assert.deepEqual(document.getMap("play").toJSON().__page__["global-chat:v1"].messages, []);
        document.destroy();
    }
});

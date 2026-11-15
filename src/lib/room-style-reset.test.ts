import assert from "node:assert/strict";
import test from "node:test";
import * as Y from "yjs";
import { syncedStore } from "@syncedstore/core";

import { getSharedRoomStyleId, resetSharedRoomStyle } from "./room-style-reset.ts";
import { getCollaborativeRoomStyleCss, ROOM_STYLE_SCAFFOLD, type CollaborativeRoomStyleData } from "./room-style.ts";

test("admin CSS reset reaches another client without changing chat or Hydra", () => {
    const writer = new Y.Doc();
    const reader = new Y.Doc();
    const store = syncedStore({ play: {} as Record<string, Record<string, unknown>> }, writer);
    store.play.__page__ = {
        "global-chat:v1": { messages: [{ text: "keep me" }], version: 1 },
        "room-hydra:v1": { code: "osc().out()", enabled: true, version: 1 },
        "room-style:v1": { css: "body {display:none}", version: 1 },
    };
    Y.applyUpdate(reader, Y.encodeStateAsUpdate(writer));
    const before = reader.getMap("play").toJSON().__page__;
    const vector = Y.encodeStateVector(reader);
    resetSharedRoomStyle(writer, "admin-reset", 1234);
    Y.applyUpdate(reader, Y.encodeStateAsUpdate(writer, vector));
    const page = reader.getMap("play").toJSON().__page__;
    assert.equal(getSharedRoomStyleId(reader), "admin-reset");
    assert.equal(getCollaborativeRoomStyleCss(page["room-style:v2"] as CollaborativeRoomStyleData, ""), ROOM_STYLE_SCAFFOLD);
    assert.equal(page["room-style:v1"].css, ROOM_STYLE_SCAFFOLD);
    assert.equal(page["room-style:v2"].chars.join(""), ROOM_STYLE_SCAFFOLD);
    assert.deepEqual(page["global-chat:v1"], before["global-chat:v1"]);
    assert.deepEqual(page["room-hydra:v1"], before["room-hydra:v1"]);
    writer.destroy();
    reader.destroy();
});

test("offline edits to the old CSS document cannot restore it after an admin reset", () => {
    const writer = new Y.Doc();
    const offline = new Y.Doc();
    resetSharedRoomStyle(writer, "old", 1);
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(writer));
    const page = offline.getMap("play").get("__page__") as Y.Map<unknown>;
    const style = page.get("room-style:v2") as Y.Map<unknown>;
    const old = style.get("current") as Y.Map<unknown>;
    const entries = old.get("entries") as Y.Array<string>;
    entries.push(["offline:x"]);
    resetSharedRoomStyle(writer, "new", 2);
    Y.applyUpdate(writer, Y.encodeStateAsUpdate(offline));
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(writer));
    for (const doc of [writer, offline]) {
        assert.equal(getSharedRoomStyleId(doc), "new");
        const current = doc.getMap("play").toJSON().__page__["room-style:v2"];
        assert.equal(getCollaborativeRoomStyleCss(current, ""), ROOM_STYLE_SCAFFOLD);
        doc.destroy();
    }
});

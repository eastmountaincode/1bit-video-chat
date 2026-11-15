import * as Y from "yjs";

import { createRoomStyleDocument, ROOM_STYLE_SCAFFOLD, ROOM_STYLE_COMMENTS_VERSION, ROOM_STYLE_TEMPLATE_VERSION, ROOM_STYLE_TEMPLATE_REVISION } from "./room-style.ts";

export function resetSharedRoomStyle(document: Y.Doc, id: string, now: number): void {
    document.transact(() => {
        const page = childMap(document.getMap("play"), "__page__");
        const style = childMap(page, "room-style:v2");
        const current = createRoomStyleDocument(ROOM_STYLE_SCAFFOLD, id, now);
        const entries = new Y.Array<string>();
        entries.push(current.entries);
        const chars = new Y.Array<string>();
        chars.push(ROOM_STYLE_SCAFFOLD.split(""));
        style.set("current", new Y.Map<unknown>([
            ["id", current.id], ["createdAt", current.createdAt], ["entries", entries],
        ]));
        style.set("chars", chars);
        style.set("scaffoldVersion", 1);
        style.set("commentsVersion", ROOM_STYLE_COMMENTS_VERSION);
        style.set("templateVersion", ROOM_STYLE_TEMPLATE_VERSION);
        style.set("templateRevision", ROOM_STYLE_TEMPLATE_REVISION);
        style.set("version", 3);
        style.set("updatedAt", now);
        style.set("updatedBy", "Admin");

        const legacy = childMap(page, "room-style:v1");
        legacy.set("css", ROOM_STYLE_SCAFFOLD);
        legacy.set("version", 1);
        legacy.set("updatedAt", now);
        legacy.set("updatedBy", "Admin");
    });
}

export function getSharedRoomStyleId(document: Y.Doc): unknown {
    const page = document.getMap("play").get("__page__");
    const style = page instanceof Y.Map ? page.get("room-style:v2") : null;
    const current = style instanceof Y.Map ? style.get("current") : null;
    return current instanceof Y.Map ? current.get("id") : null;
}

function childMap(parent: Y.Map<unknown>, key: string): Y.Map<unknown> {
    const existing = parent.get(key);
    if (existing instanceof Y.Map) return existing;
    const map = new Y.Map<unknown>();
    parent.set(key, map);
    return map;
}

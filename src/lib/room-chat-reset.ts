import * as Y from "yjs";

export function clearSharedRoomChat(document: Y.Doc, id: string, now: number): void {
    document.transact(() => {
        const page = childMap(document.getMap("play"), "__page__");
        const chat = childMap(page, "global-chat:v1");
        // Replace the array so edits to an offline copy cannot restore old messages.
        chat.set("messages", new Y.Array());
        chat.set("resetId", id);
        chat.set("updatedAt", now);
        chat.set("version", 1);
    });
}

export function getSharedRoomChatResetId(document: Y.Doc): unknown {
    const page = document.getMap("play").get("__page__");
    const chat = page instanceof Y.Map ? page.get("global-chat:v1") : null;
    return chat instanceof Y.Map ? chat.get("resetId") : null;
}

function childMap(parent: Y.Map<unknown>, key: string): Y.Map<unknown> {
    const existing = parent.get(key);
    if (existing instanceof Y.Map) return existing;
    const map = new Y.Map<unknown>();
    parent.set(key, map);
    return map;
}

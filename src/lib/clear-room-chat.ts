import "server-only";

import { clearSharedRoomChat, getSharedRoomChatResetId } from "./room-chat-reset.ts";
import { updateRoomDocument } from "./update-room-document.ts";

export async function clearRoomChat(roomId: string, site: URL): Promise<void> {
    const id = crypto.randomUUID();
    await updateRoomDocument(
        roomId,
        site,
        (document) => clearSharedRoomChat(document, id, Date.now()),
        (document) => getSharedRoomChatResetId(document) === id,
    );
}

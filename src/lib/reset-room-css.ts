import "server-only";

import { getSharedRoomStyleId, resetSharedRoomStyle } from "./room-style-reset.ts";
import { updateRoomDocument } from "./update-room-document.ts";

export async function resetRoomCss(roomId: string, site: URL): Promise<void> {
    const id = crypto.randomUUID();
    await updateRoomDocument(
        roomId,
        site,
        (document) => resetSharedRoomStyle(document, id, Date.now()),
        (document) => getSharedRoomStyleId(document) === id,
    );
}

import "server-only";

import * as Y from "yjs";
import YProvider from "y-partyserver/provider";

import { getPlayHtmlRoomForPath } from "./room-directory.ts";
import { getSharedRoomStyleId, resetSharedRoomStyle } from "./room-style-reset.ts";

const SYNC_TIMEOUT_MS = 10_000;

export async function resetRoomCss(roomId: string, site: URL): Promise<void> {
    // Match PlayHTML's host-scoped room identity, including local and preview hosts.
    const room = encodeURIComponent(`${site.host.replace(/^www\./i, "")}-${getPlayHtmlRoomForPath(`/rooms/${roomId}`)}`);
    const host = site.hostname.includes("staging") || site.hostname.includes("ngrok-free")
        ? "playhtml-staging.spencerc99.workers.dev" : "playhtml.spencerc99.workers.dev";
    const connections: { document: Y.Doc; provider: YProvider }[] = [];

    function connect() {
        const document = new Y.Doc();
        const provider = new YProvider(host, room, document, {
            disableBc: true,
            params: { sharedElements: "[]", sharedReferences: "[]" },
            WebSocketPolyfill: WebSocket,
        });
        provider.awareness.setLocalState(null);
        const connection = { document, provider };
        connections.push(connection);
        return connection;
    }

    try {
        const writer = connect();
        await waitFor(writer, () => writer.provider.synced);
        const id = crypto.randomUUID();
        resetSharedRoomStyle(writer.document, id, Date.now());

        // A separate connection verifies the relay received the new document.
        const reader = connect();
        await waitFor(reader, () => reader.provider.synced && getSharedRoomStyleId(reader.document) === id);
    } finally {
        for (const { provider, document } of connections) {
            provider.destroy();
            document.destroy();
        }
    }
}

function waitFor(
    { provider, document }: { provider: YProvider; document: Y.Doc },
    ready: () => boolean,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error("CSS reset did not synchronize."));
        }, SYNC_TIMEOUT_MS);
        function cleanup() {
            clearTimeout(timeout);
            provider.off("sync", check);
            document.off("update", check);
        }
        function check() {
            if (!ready()) return;
            cleanup();
            resolve();
        }
        provider.on("sync", check);
        document.on("update", check);
        check();
    });
}

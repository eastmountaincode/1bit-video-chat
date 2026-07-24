"use client";

import { useEffect } from "react";

import { MAIN_ROOM } from "@/lib/room-directory";
import { ROOM_HEARTBEAT_INTERVAL_MS } from "@/lib/room-lifecycle";

const HEARTBEAT_REQUEST_TIMEOUT_MS = 8 * 1_000;

export function useRoomHeartbeat(roomId: string) {
  useEffect(() => {
    if (roomId === MAIN_ROOM.id) return;

    let activeRequest: AbortController | null = null;
    let expired = false;
    let requestInFlight = false;
    let stopped = false;

    async function renewRoom() {
      if (expired || requestInFlight || stopped) return;
      requestInFlight = true;
      const controller = new AbortController();
      activeRequest = controller;
      const requestTimer = window.setTimeout(
        () => controller.abort(),
        HEARTBEAT_REQUEST_TIMEOUT_MS,
      );

      try {
        const response = await fetch(
          `/api/rooms/${encodeURIComponent(roomId)}/heartbeat`,
          {
            cache: "no-store",
            method: "POST",
            signal: controller.signal,
          },
        );

        if (!stopped && response.status === 410) {
          expired = true;
          window.location.reload();
        }
      } catch {
        // A transient network failure must not be mistaken for an expired room.
      } finally {
        window.clearTimeout(requestTimer);
        if (activeRequest === controller) activeRequest = null;
        requestInFlight = false;
      }
    }

    function renewVisibleRoom() {
      if (document.visibilityState === "visible") void renewRoom();
    }

    void renewRoom();
    const heartbeatTimer = window.setInterval(
      () => void renewRoom(),
      ROOM_HEARTBEAT_INTERVAL_MS,
    );
    window.addEventListener("online", renewRoom);
    window.addEventListener("pageshow", renewRoom);
    document.addEventListener("visibilitychange", renewVisibleRoom);

    return () => {
      stopped = true;
      activeRequest?.abort();
      window.clearInterval(heartbeatTimer);
      window.removeEventListener("online", renewRoom);
      window.removeEventListener("pageshow", renewRoom);
      document.removeEventListener("visibilitychange", renewVisibleRoom);
    };
  }, [roomId]);
}

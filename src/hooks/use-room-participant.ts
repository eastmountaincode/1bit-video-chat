"use client";

import { useEffect, useEffectEvent } from "react";

import { ROOM_PARTICIPANT_CAPACITY } from "@/lib/room-directory";
import { ROOM_HEARTBEAT_INTERVAL_MS } from "@/lib/room-lifecycle";

const PARTICIPANT_REQUEST_TIMEOUT_MS = 8 * 1_000;

export interface RoomParticipantRequestResult {
  capacity: number;
  error: string | null;
  ok: boolean;
  participantCount: number | null;
  status: number;
}

interface UseRoomParticipantOptions {
  onMembershipLost: (message: string) => void;
  onParticipantCount: (participantCount: number) => void;
  participantId: string | null;
  roomId: string;
}

export function createRoomParticipantId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export async function getRoomParticipantCount(
  roomId: string,
): Promise<RoomParticipantRequestResult> {
  return requestRoomParticipant(roomId, { method: "GET" });
}

export async function admitRoomParticipant(
  roomId: string,
  participantId: string,
): Promise<RoomParticipantRequestResult> {
  return requestRoomParticipant(roomId, {
    body: JSON.stringify({ participantId }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

export function leaveRoomParticipant(
  roomId: string,
  participantId: string,
): Promise<RoomParticipantRequestResult> {
  return requestRoomParticipant(
    roomId,
    {
      body: JSON.stringify({ participantId }),
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      method: "DELETE",
    },
    false,
  );
}

export function useRoomParticipant({
  onMembershipLost,
  onParticipantCount,
  participantId,
  roomId,
}: UseRoomParticipantOptions) {
  const reportMembershipLost = useEffectEvent(onMembershipLost);
  const reportParticipantCount = useEffectEvent(onParticipantCount);

  useEffect(() => {
    if (!participantId) return;
    const activeParticipantId = participantId;

    let membershipLost = false;
    let requestInFlight = false;
    let stopped = false;

    async function renewParticipant() {
      if (requestInFlight || membershipLost || stopped) return;

      requestInFlight = true;
      const result = await admitRoomParticipant(
        roomId,
        activeParticipantId,
      );
      requestInFlight = false;
      if (stopped) return;

      if (result.participantCount !== null) {
        reportParticipantCount(result.participantCount);
      }
      if (result.status === 409 || result.status === 410) {
        membershipLost = true;
        reportMembershipLost(
          result.error ??
            (result.status === 409
              ? "This room is full."
              : "This room has expired."),
        );
      }
    }

    function renewVisibleParticipant() {
      if (document.visibilityState === "visible") {
        void renewParticipant();
      }
    }

    function releaseParticipant() {
      void leaveRoomParticipant(roomId, activeParticipantId);
    }

    void renewParticipant();
    const heartbeatTimer = window.setInterval(
      () => void renewParticipant(),
      ROOM_HEARTBEAT_INTERVAL_MS,
    );
    window.addEventListener("online", renewParticipant);
    window.addEventListener("pageshow", renewParticipant);
    window.addEventListener("pagehide", releaseParticipant);
    document.addEventListener(
      "visibilitychange",
      renewVisibleParticipant,
    );

    return () => {
      stopped = true;
      window.clearInterval(heartbeatTimer);
      window.removeEventListener("online", renewParticipant);
      window.removeEventListener("pageshow", renewParticipant);
      window.removeEventListener("pagehide", releaseParticipant);
      document.removeEventListener(
        "visibilitychange",
        renewVisibleParticipant,
      );
    };
  }, [participantId, roomId]);
}

async function requestRoomParticipant(
  roomId: string,
  init: RequestInit,
  withTimeout = true,
): Promise<RoomParticipantRequestResult> {
  const controller = withTimeout ? new AbortController() : null;
  const requestSignal = init.signal ?? controller?.signal;
  const timeout =
    controller === null
      ? null
      : window.setTimeout(
          () => controller.abort(),
          PARTICIPANT_REQUEST_TIMEOUT_MS,
        );

  try {
    const response = await fetch(
      `/api/rooms/${encodeURIComponent(roomId)}/participants`,
      {
        ...init,
        cache: "no-store",
        signal: requestSignal,
      },
    );
    const body = await readJsonObject(response);
    const participantCount = readParticipantCount(body?.participantCount);

    return {
      capacity: ROOM_PARTICIPANT_CAPACITY,
      error: typeof body?.error === "string" ? body.error : null,
      ok: response.ok,
      participantCount,
      status: response.status,
    };
  } catch {
    return {
      capacity: ROOM_PARTICIPANT_CAPACITY,
      error: "The room server is unavailable.",
      ok: false,
      participantCount: null,
      status: 0,
    };
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
  }
}

function readParticipantCount(value: unknown): number | null {
  return Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= ROOM_PARTICIPANT_CAPACITY
    ? (value as number)
    : null;
}

async function readJsonObject(
  response: Response,
): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await response.json();
    return value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

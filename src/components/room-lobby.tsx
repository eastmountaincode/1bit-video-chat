"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  getPublicRoomListings,
  getRoomHref,
  type PublicRoomListing,
} from "@/lib/room-directory";
import { ROOM_LIST_REFRESH_MS } from "@/lib/room-lifecycle";

const ROOM_REQUEST_TIMEOUT_MS = 8_000;

export function RoomLobby() {
  const [listError, setListError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<PublicRoomListing[] | null>(null);

  useEffect(() => {
    let activeRequest: AbortController | null = null;
    let stopped = false;

    async function refreshRooms() {
      if (activeRequest || stopped) return;

      const controller = new AbortController();
      activeRequest = controller;
      const timeout = window.setTimeout(
        () => controller.abort(),
        ROOM_REQUEST_TIMEOUT_MS,
      );

      try {
        const response = await fetch("/api/rooms", {
          signal: controller.signal,
        });
        const body = await readJsonObject(response);
        if (!Array.isArray(body?.rooms)) {
          throw new Error("The room list is unavailable.");
        }

        if (!stopped) {
          setRooms(getPublicRoomListings(body.rooms));
          setListError(
            response.ok
              ? null
              : typeof body.error === "string"
                ? body.error
                : "Could not refresh rooms.",
          );
        }
      } catch {
        if (!stopped) {
          setRooms(
            (currentRooms) => currentRooms ?? getPublicRoomListings([]),
          );
          setListError("Could not refresh rooms.");
        }
      } finally {
        window.clearTimeout(timeout);
        if (activeRequest === controller) activeRequest = null;
      }
    }

    function refreshVisibleRooms() {
      if (document.visibilityState === "visible") void refreshRooms();
    }

    void refreshRooms();
    const refreshTimer = window.setInterval(
      refreshVisibleRooms,
      ROOM_LIST_REFRESH_MS,
    );
    window.addEventListener("focus", refreshVisibleRooms);
    document.addEventListener("visibilitychange", refreshVisibleRooms);

    return () => {
      stopped = true;
      activeRequest?.abort();
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshVisibleRooms);
      document.removeEventListener("visibilitychange", refreshVisibleRooms);
    };
  }, []);

  return (
    <main className="lobby-page">
      <div className="lobby-shell">
        <header className="lobby-header">
          <Image
            alt=""
            className="lobby-mark"
            height={40}
            priority
            src="/icon.svg"
            width={40}
          />
          <h1>Telepathy</h1>
          <Link className="about-link" href="/about">About</Link>
        </header>

        <fieldset
          aria-busy={rooms === null && listError === null}
          className="room-list-fieldset"
        >
          <legend>Rooms</legend>
          {rooms === null && !listError ? (
            <p
              aria-label="Loading rooms"
              className="room-list-loading"
              role="status"
            >
              ...
            </p>
          ) : rooms ? (
            <ul className="room-list">
              {rooms.map((room) => (
                <li key={room.id}>
                  <strong>{room.name}</strong>
                  <span className="room-list-actions">
                    <span className="room-participant-count">
                      ({room.participantCount}/{room.capacity})
                    </span>
                    {/* A fresh document guarantees a fresh PlayHTML room transport. */}
                    <a
                      aria-disabled={
                        room.participantCount >= room.capacity || undefined
                      }
                      aria-label={`Join ${room.name}`}
                      className="room-join-link"
                      href={
                        room.participantCount < room.capacity
                          ? getRoomHref(room)
                          : undefined
                      }
                      tabIndex={
                        room.participantCount >= room.capacity
                          ? -1
                          : undefined
                      }
                    >
                      Join
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="error-note" role="alert">
              The room list is unavailable.
            </p>
          )}
        </fieldset>

        {listError ? (
          <p className="lobby-note" role="status">
            {listError}
          </p>
        ) : null}
      </div>
    </main>
  );
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

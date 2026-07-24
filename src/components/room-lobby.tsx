"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  getPublicRooms,
  getRoomHref,
  MAX_PUBLIC_ROOMS,
  normalizeRoomName,
  parsePublicRoom,
  ROOM_NAME_MAX_LENGTH,
  type PublicRoom,
} from "@/lib/room-directory";
import { ROOM_LIST_REFRESH_MS } from "@/lib/room-lifecycle";

const ROOM_REQUEST_TIMEOUT_MS = 8_000;

export function RoomLobby() {
  const createRequestRef = useRef<AbortController | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  const normalizedName = normalizeRoomName(name);
  const isAtCapacity = !rooms || rooms.length >= MAX_PUBLIC_ROOMS;

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
          setRooms(getPublicRooms(body.rooms));
          setListError(
            response.ok
              ? null
              : typeof body.error === "string"
                ? body.error
                : "New rooms are temporarily unavailable.",
          );
        }
      } catch {
        if (!stopped) {
          setRooms((currentRooms) => currentRooms ?? getPublicRooms([]));
          setListError("New rooms are temporarily unavailable.");
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

  useEffect(
    () => () => {
      const controller = createRequestRef.current;
      createRequestRef.current = null;
      controller?.abort();
    },
    [],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createRequestRef.current) return;
    setError(null);

    if (!rooms) {
      setError("The room list is unavailable.");
      return;
    }
    if (!normalizedName) {
      setError("Enter a room name.");
      return;
    }
    if (isAtCapacity) {
      setError("The public room list is full.");
      return;
    }

    setIsCreating(true);
    const controller = new AbortController();
    createRequestRef.current = controller;
    const timeout = window.setTimeout(
      () => controller.abort(),
      ROOM_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch("/api/rooms", {
        body: JSON.stringify({ name }),
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        method: "POST",
        signal: controller.signal,
      });
      const body = await readJsonObject(response);
      const room = parsePublicRoom(body?.room);

      if (!response.ok || !room) {
        if (createRequestRef.current === controller) {
          setError(
            typeof body?.error === "string"
              ? body.error
              : "The room could not be created.",
          );
        }
        return;
      }

      window.location.assign(getRoomHref(room));
    } catch {
      if (createRequestRef.current === controller) {
        setError("The room could not be created.");
      }
    } finally {
      window.clearTimeout(timeout);
      if (createRequestRef.current === controller) {
        createRequestRef.current = null;
        setIsCreating(false);
      }
    }
  }

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
                  {/* A fresh document guarantees a fresh PlayHTML room transport. */}
                  <a
                    aria-label={`Join ${room.name}`}
                    className="room-join-link"
                    href={getRoomHref(room)}
                  >
                    Join
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p role="alert">The room list is unavailable.</p>
          )}
        </fieldset>

        {listError ? (
          <p className="lobby-note" role="status">
            {listError}
          </p>
        ) : null}

        {rooms &&
          !listError &&
          (isCreateOpen ? (
            <form
              className="room-create-form"
              id="room-create-form"
              onSubmit={handleSubmit}
            >
              <fieldset disabled={isCreating}>
                <legend>Create a room</legend>
                <label className="room-name-field">
                  Room name
                  <input
                    autoComplete="off"
                    autoFocus
                    maxLength={ROOM_NAME_MAX_LENGTH}
                    onChange={(event) => setName(event.target.value)}
                    value={name}
                  />
                </label>
                <button
                  disabled={
                    isAtCapacity ||
                    !normalizedName ||
                    isCreating
                  }
                  type="submit"
                >
                  {isCreating ? "Creating..." : "Create room"}
                </button>
              </fieldset>
            </form>
          ) : (
            <button
              aria-controls="room-create-form"
              aria-expanded="false"
              className="room-create-toggle"
              onClick={() => setIsCreateOpen(true)}
              type="button"
            >
              Create a room
            </button>
          ))}

        {error ? (
          <p className="lobby-note lobby-error" role="alert">
            {error}
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

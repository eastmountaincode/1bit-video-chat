"use client";

import { usePageData, usePlayContext } from "@playhtml/react";
import Image from "next/image";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  addRoomToDirectory,
  createPublicRoom,
  DEFAULT_ROOM_DIRECTORY,
  getPublicRooms,
  getRoomHref,
  MAX_PUBLIC_ROOMS,
  normalizeRoomName,
  ROOM_DIRECTORY_DATA_KEY,
  ROOM_NAME_MAX_LENGTH,
  type PublicRoom,
  type RoomDirectoryData,
} from "@/lib/room-directory";

const NAVIGATION_GRACE_MS = 120;
const LOADING_DOT_INTERVAL_MS = 450;

function LoadingDots() {
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setDotCount((current) => (current === 3 ? 1 : current + 1));
    }, LOADING_DOT_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <span aria-hidden="true" className="room-list-loading-dots">
      {".".repeat(dotCount)}
    </span>
  );
}

export function RoomLobby() {
  const [directory, setDirectory] = usePageData<RoomDirectoryData>(
    ROOM_DIRECTORY_DATA_KEY,
    DEFAULT_ROOM_DIRECTORY,
  );
  const { isLoading } = usePlayContext();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pendingRoom, setPendingRoom] = useState<PublicRoom | null>(null);
  const rooms = useMemo(() => getPublicRooms(directory), [directory]);
  const normalizedName = normalizeRoomName(name);
  const isAtCapacity = rooms.length >= MAX_PUBLIC_ROOMS;

  useEffect(() => {
    if (!pendingRoom || !rooms.some((room) => room.id === pendingRoom.id)) {
      return;
    }

    const navigationTimer = window.setTimeout(() => {
      window.location.assign(getRoomHref(pendingRoom));
    }, NAVIGATION_GRACE_MS);

    return () => window.clearTimeout(navigationTimer);
  }, [pendingRoom, rooms]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (isLoading) {
      setError("The room list is still connecting.");
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

    const room = createPublicRoom(name, crypto.randomUUID(), Date.now());
    if (!room) {
      setError("That room name could not be used.");
      return;
    }

    let added = false;
    setDirectory((draft) => {
      added = addRoomToDirectory(draft, room);
    });

    if (!added) {
      setError("The room could not be added. Try again.");
      return;
    }

    setPendingRoom(room);
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

        <fieldset aria-busy={isLoading} className="room-list-fieldset">
          <legend>Rooms</legend>
          {isLoading ? (
            <p className="room-list-loading" role="status">
              Connecting to the room list
              <LoadingDots />
            </p>
          ) : (
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
          )}
        </fieldset>

        {!isLoading &&
          (isCreateOpen ? (
            <form
              className="room-create-form"
              id="room-create-form"
              onSubmit={handleSubmit}
            >
              <fieldset disabled={pendingRoom !== null}>
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
                    pendingRoom !== null
                  }
                  type="submit"
                >
                  {pendingRoom ? "Creating…" : "Create room"}
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

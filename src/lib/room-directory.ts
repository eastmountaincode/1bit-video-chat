export const ROOM_NAME_MAX_LENGTH = 48;
export const ROOM_ID_MAX_LENGTH = 64;
export const MAX_PUBLIC_ROOMS = 100;
export const ROOM_PARTICIPANT_CAPACITY = 20;

export const PLAYHTML_LOBBY_ROOM = "one-bit-video-chat:lobby:v1";
export const PLAYHTML_LEGACY_MAIN_ROOM = "one-bit-video-chat:main:v1";

const ROOM_ID_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const CONTROL_AND_BIDI_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const MAX_FUTURE_TIMESTAMP_MS = 5 * 60 * 1_000;

export interface PublicRoom {
  createdAt: number;
  id: string;
  name: string;
}

export interface PublicRoomListing extends PublicRoom {
  capacity: number;
  participantCount: number;
}

export const MAIN_ROOM: PublicRoom = {
  createdAt: 0,
  id: "main",
  name: "Main room",
};

export function normalizeRoomName(value: unknown): string {
  if (typeof value !== "string") return "";

  const normalized = value
    .normalize("NFKC")
    .replace(CONTROL_AND_BIDI_PATTERN, "")
    .replace(/\s+/gu, " ")
    .trim();

  return Array.from(normalized).slice(0, ROOM_NAME_MAX_LENGTH).join("");
}

export function isValidRoomId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= ROOM_ID_MAX_LENGTH &&
    ROOM_ID_PATTERN.test(value)
  );
}

export function createPublicRoom(
  rawName: unknown,
  entropy: string,
  createdAt: number,
): PublicRoom | null {
  const name = normalizeRoomName(rawName);
  const suffix = entropy.toLowerCase().replace(/[^a-f0-9]/g, "").slice(0, 12);

  if (!name || suffix.length !== 12 || !isValidRoomTimestamp(createdAt)) {
    return null;
  }

  const maxSlugLength = ROOM_ID_MAX_LENGTH - suffix.length - 1;
  const slug = slugifyRoomName(name).slice(0, maxSlugLength).replace(/-+$/g, "");
  const id = `${slug || "room"}-${suffix}`;

  return isValidRoomId(id) ? { createdAt, id, name } : null;
}

export function getPublicRooms(
  value: unknown,
  now = Date.now(),
): PublicRoom[] {
  const roomsById = new Map<string, PublicRoom>([[MAIN_ROOM.id, MAIN_ROOM]]);

  if (Array.isArray(value)) {
    for (const candidate of value.slice(0, MAX_PUBLIC_ROOMS * 4)) {
      const room = parsePublicRoom(candidate, now);
      if (room && room.id !== MAIN_ROOM.id) {
        roomsById.set(room.id, room);
      }
    }
  }

  return [...roomsById.values()]
    .sort((left, right) => {
      if (left.id === MAIN_ROOM.id) return -1;
      if (right.id === MAIN_ROOM.id) return 1;
      return right.createdAt - left.createdAt || left.name.localeCompare(right.name);
    })
    .slice(0, MAX_PUBLIC_ROOMS);
}

export function getPublicRoomListings(
  value: unknown,
  now = Date.now(),
): PublicRoomListing[] {
  const listingsById = new Map<string, PublicRoomListing>([
    [MAIN_ROOM.id, createPublicRoomListing(MAIN_ROOM, 0)],
  ]);

  if (Array.isArray(value)) {
    for (const candidate of value.slice(0, MAX_PUBLIC_ROOMS * 4)) {
      const listing = parsePublicRoomListing(candidate, now);
      if (listing) listingsById.set(listing.id, listing);
    }
  }

  return getPublicRooms([...listingsById.values()], now).map(
    (room) =>
      listingsById.get(room.id) ?? createPublicRoomListing(room, 0),
  );
}

export function createPublicRoomListing(
  room: PublicRoom,
  participantCount: number,
): PublicRoomListing {
  return {
    ...room,
    capacity: ROOM_PARTICIPANT_CAPACITY,
    participantCount: normalizeParticipantCount(participantCount),
  };
}

export function getPlayHtmlRoomForPath(pathname: string): string {
  if (pathname === "/" || pathname === "") return PLAYHTML_LOBBY_ROOM;

  const match = /^\/rooms\/([^/]+)\/?$/.exec(pathname);
  if (!match) return "one-bit-video-chat:invalid-route:v1";

  let roomId: string;
  try {
    roomId = decodeURIComponent(match[1]);
  } catch {
    return "one-bit-video-chat:invalid-route:v1";
  }

  if (!isValidRoomId(roomId)) return "one-bit-video-chat:invalid-route:v1";
  if (roomId === MAIN_ROOM.id) return PLAYHTML_LEGACY_MAIN_ROOM;

  return `one-bit-video-chat:room:${roomId}:v1`;
}

export function getRoomHref(room: PublicRoom): string {
  return `/rooms/${room.id}`;
}

export function parsePublicRoom(
  value: unknown,
  now = Date.now(),
): PublicRoom | null {
  const record = asRecord(value);
  if (!record || !isValidRoomId(record.id)) return null;

  return isValidPublicRoom(record, record.id, now)
    ? {
        createdAt: record.createdAt,
        id: record.id,
        name: record.name,
      }
    : null;
}

export function parsePublicRoomListing(
  value: unknown,
  now = Date.now(),
): PublicRoomListing | null {
  const record = asRecord(value);
  const room = parsePublicRoom(record, now);
  if (
    !room ||
    record?.capacity !== ROOM_PARTICIPANT_CAPACITY ||
    !Number.isInteger(record.participantCount) ||
    (record.participantCount as number) < 0 ||
    (record.participantCount as number) > ROOM_PARTICIPANT_CAPACITY
  ) {
    return null;
  }

  return createPublicRoomListing(
    room,
    record.participantCount as number,
  );
}

function slugifyRoomName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function isValidPublicRoom(
  value: unknown,
  expectedId: string,
  now: number,
): value is PublicRoom {
  const record = asRecord(value);
  return Boolean(
    record &&
      record.id === expectedId &&
      isValidRoomId(record.id) &&
      normalizeRoomName(record.name) === record.name &&
      record.name.length > 0 &&
      isValidRoomTimestamp(record.createdAt, now),
  );
}

function isValidRoomTimestamp(value: unknown, now = Date.now()): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= now + MAX_FUTURE_TIMESTAMP_MS
  );
}

function normalizeParticipantCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(
    0,
    Math.min(ROOM_PARTICIPANT_CAPACITY, Math.floor(value)),
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

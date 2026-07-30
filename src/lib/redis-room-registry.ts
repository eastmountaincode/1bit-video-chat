import "server-only";

import { Redis } from "@upstash/redis";

import {
  createPublicRoomListing,
  createPublicRoom,
  getPublicRooms,
  isValidRoomId,
  MAIN_ROOM,
  MAX_PUBLIC_ROOMS,
  parsePublicRoom,
  ROOM_PARTICIPANT_CAPACITY,
  type PublicRoom,
  type PublicRoomListing,
} from "@/lib/room-directory";
import {
  ROOM_EMPTY_GRACE_MS,
  ROOM_EXPIRY_ENABLED,
  ROOM_HEARTBEAT_DEADLINE_MS,
  ROOM_PARTICIPANT_LEASE_MS,
} from "@/lib/room-lifecycle";

const ROOM_REGISTRY_ENVIRONMENT = (
  process.env.TELEPATHY_ROOM_REGISTRY_NAMESPACE ??
  process.env.VERCEL_ENV ??
  process.env.NODE_ENV ??
  "development"
).replace(/[^a-z0-9_-]/gi, "-");
const ROOM_KEY_TAG = `telepathy:{rooms:v2:${ROOM_REGISTRY_ENVIRONMENT}}`;
const ROOM_INDEX_KEY = `${ROOM_KEY_TAG}:index`;
const ROOM_METADATA_KEY = `${ROOM_KEY_TAG}:metadata`;
const ROOM_PARTICIPANT_KEY_PREFIX = `${ROOM_KEY_TAG}:participants:`;
const ROOM_CREATION_RATE_LIMIT = 5;
const ROOM_CREATION_RATE_WINDOW_MS = 60 * 1_000;
const MAX_EPHEMERAL_ROOMS = MAX_PUBLIC_ROOMS - 1;
const ROOM_EXPIRY_ENABLED_LUA = ROOM_EXPIRY_ENABLED ? "true" : "false";

const CREATE_ROOM_SCRIPT = `
local time = redis.call("TIME")
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local roomExpiryEnabled = ${ROOM_EXPIRY_ENABLED_LUA}
if roomExpiryEnabled then
  local expired = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", now)
  if #expired > 0 then
    redis.call("HDEL", KEYS[2], unpack(expired))
    redis.call("ZREM", KEYS[1], unpack(expired))
    for _, id in ipairs(expired) do
      redis.call("DEL", ARGV[7] .. id)
    end
  end
end

local createCount = redis.call("INCR", KEYS[3])
if createCount == 1 then
  redis.call("PEXPIRE", KEYS[3], tonumber(ARGV[5]))
end
if createCount > tonumber(ARGV[4]) then
  return {-2, now, 0}
end

if redis.call("ZCARD", KEYS[1]) >= tonumber(ARGV[3]) then
  return {-1, now, 0}
end
if redis.call("HEXISTS", KEYS[2], ARGV[1]) == 1 then
  return {0, now, 0}
end

local deadline = now + tonumber(ARGV[2])
redis.call("HSET", KEYS[2], ARGV[1], ARGV[6])
redis.call("ZADD", KEYS[1], deadline, ARGV[1])
return {1, now, deadline}
`;

const LIST_ROOMS_SCRIPT = `
local time = redis.call("TIME")
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local roomExpiryEnabled = ${ROOM_EXPIRY_ENABLED_LUA}
if roomExpiryEnabled then
  local expired = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", now)
  if #expired > 0 then
    redis.call("HDEL", KEYS[2], unpack(expired))
    redis.call("ZREM", KEYS[1], unpack(expired))
    for _, id in ipairs(expired) do
      redis.call("DEL", ARGV[2] .. id)
    end
  end
end

local ids = redis.call("ZREVRANGE", KEYS[1], 0, tonumber(ARGV[1]) - 1)
local rooms = {}
for _, id in ipairs(ids) do
  local room = redis.call("HGET", KEYS[2], id)
  if room then
    table.insert(rooms, room)
  else
    redis.call("ZREM", KEYS[1], id)
    redis.call("DEL", ARGV[2] .. id)
  end
end
return rooms
`;

const GET_ROOM_SCRIPT = `
local time = redis.call("TIME")
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local roomExpiryEnabled = ${ROOM_EXPIRY_ENABLED_LUA}
local deadline = redis.call("ZSCORE", KEYS[1], ARGV[1])
if not deadline or (roomExpiryEnabled and tonumber(deadline) <= now) then
  redis.call("ZREM", KEYS[1], ARGV[1])
  redis.call("HDEL", KEYS[2], ARGV[1])
  redis.call("DEL", KEYS[3])
  return nil
end

local room = redis.call("HGET", KEYS[2], ARGV[1])
if not room then
  redis.call("ZREM", KEYS[1], ARGV[1])
  redis.call("DEL", KEYS[3])
  return nil
end
return room
`;

const COUNT_ROOM_PARTICIPANTS_SCRIPT = `
local time = redis.call("TIME")
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local counts = {}
for _, key in ipairs(KEYS) do
  redis.call("ZREMRANGEBYSCORE", key, "-inf", now)
  table.insert(counts, redis.call("ZCARD", key))
end
return counts
`;

const GET_ROOM_PARTICIPANT_COUNT_SCRIPT = `
local time = redis.call("TIME")
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local roomExpiryEnabled = ${ROOM_EXPIRY_ENABLED_LUA}
if ARGV[2] ~= "1" then
  local deadline = redis.call("ZSCORE", KEYS[1], ARGV[1])
  if not deadline or (roomExpiryEnabled and tonumber(deadline) <= now) then
    redis.call("ZREM", KEYS[1], ARGV[1])
    redis.call("HDEL", KEYS[2], ARGV[1])
    redis.call("DEL", KEYS[3])
    return {-1, 0}
  end
  if redis.call("HEXISTS", KEYS[2], ARGV[1]) == 0 then
    redis.call("ZREM", KEYS[1], ARGV[1])
    redis.call("DEL", KEYS[3])
    return {-1, 0}
  end
end

redis.call("ZREMRANGEBYSCORE", KEYS[3], "-inf", now)
return {1, redis.call("ZCARD", KEYS[3])}
`;

const ADMIT_ROOM_PARTICIPANT_SCRIPT = `
local time = redis.call("TIME")
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local roomExpiryEnabled = ${ROOM_EXPIRY_ENABLED_LUA}
if ARGV[6] ~= "1" then
  local deadline = redis.call("ZSCORE", KEYS[1], ARGV[1])
  if not deadline or (roomExpiryEnabled and tonumber(deadline) <= now) then
    redis.call("ZREM", KEYS[1], ARGV[1])
    redis.call("HDEL", KEYS[2], ARGV[1])
    redis.call("DEL", KEYS[3])
    return {-1, 0, now}
  end
  if redis.call("HEXISTS", KEYS[2], ARGV[1]) == 0 then
    redis.call("ZREM", KEYS[1], ARGV[1])
    redis.call("DEL", KEYS[3])
    return {-1, 0, now}
  end
end

redis.call("ZREMRANGEBYSCORE", KEYS[3], "-inf", now)
local existing = redis.call("ZSCORE", KEYS[3], ARGV[2])
local count = redis.call("ZCARD", KEYS[3])
if not existing and count >= tonumber(ARGV[3]) then
  return {0, count, now}
end

local participantDeadline = now + tonumber(ARGV[4])
redis.call("ZADD", KEYS[3], participantDeadline, ARGV[2])
count = redis.call("ZCARD", KEYS[3])
if ARGV[6] ~= "1" then
  local roomDeadline = now + tonumber(ARGV[5])
  redis.call("ZADD", KEYS[1], "XX", "GT", roomDeadline, ARGV[1])
end
return {1, count, participantDeadline}
`;

const LEAVE_ROOM_PARTICIPANT_SCRIPT = `
local time = redis.call("TIME")
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
redis.call("ZREMRANGEBYSCORE", KEYS[3], "-inf", now)
redis.call("ZREM", KEYS[3], ARGV[2])
local count = redis.call("ZCARD", KEYS[3])

if ARGV[4] ~= "1" and count == 0 then
  local deadline = redis.call("ZSCORE", KEYS[1], ARGV[1])
  if deadline and tonumber(deadline) > now and redis.call("HEXISTS", KEYS[2], ARGV[1]) == 1 then
    redis.call("ZADD", KEYS[1], "XX", now + tonumber(ARGV[3]), ARGV[1])
  end
end
return count
`;

let redisClient: Redis | null = null;

export class RoomRegistryUnavailableError extends Error {
  constructor(message = "The room server is unavailable.") {
    super(message);
    this.name = "RoomRegistryUnavailableError";
  }
}

export class RoomRegistryCapacityError extends Error {
  constructor() {
    super("The public room list is full.");
    this.name = "RoomRegistryCapacityError";
  }
}

export class RoomRegistryRateLimitError extends Error {
  constructor() {
    super("Too many rooms were created. Wait a minute and try again.");
    this.name = "RoomRegistryRateLimitError";
  }
}

export class RoomParticipantCapacityError extends Error {
  readonly participantCount: number;

  constructor(participantCount = ROOM_PARTICIPANT_CAPACITY) {
    super("This room is full.");
    this.name = "RoomParticipantCapacityError";
    this.participantCount = participantCount;
  }
}

export async function listPublicRooms(): Promise<PublicRoomListing[]> {
  const redis = getRedis();
  const storedRooms = await redis.eval<unknown[], unknown>(
    LIST_ROOMS_SCRIPT,
    [ROOM_INDEX_KEY, ROOM_METADATA_KEY],
    [MAX_EPHEMERAL_ROOMS, ROOM_PARTICIPANT_KEY_PREFIX],
  );
  if (!Array.isArray(storedRooms)) throw new RoomRegistryUnavailableError();

  const decodedRooms = storedRooms.map(decodeStoredRoom);
  if (decodedRooms.some((room) => room === null)) {
    throw new RoomRegistryUnavailableError();
  }

  const rooms = getPublicRooms(decodedRooms);
  const counts = await getRoomParticipantCounts(rooms);
  return rooms.map((room, index) =>
    createPublicRoomListing(room, counts[index] ?? 0),
  );
}

export async function getPublicRoom(
  roomId: string,
): Promise<PublicRoom | null> {
  if (roomId === MAIN_ROOM.id) return MAIN_ROOM;
  if (!isValidRoomId(roomId)) return null;

  const redis = getRedis();
  const storedRoom = await redis.eval<[string], unknown>(
    GET_ROOM_SCRIPT,
    [
      ROOM_INDEX_KEY,
      ROOM_METADATA_KEY,
      getRoomParticipantKey(roomId),
    ],
    [roomId],
  );

  if (storedRoom === null) return null;
  const room = decodeStoredRoom(storedRoom);
  if (!room || room.id !== roomId) throw new RoomRegistryUnavailableError();
  return room;
}

export async function createRegisteredRoom(
  rawName: unknown,
  rateLimitId: string,
): Promise<PublicRoom> {
  const room = createPublicRoom(rawName, crypto.randomUUID(), Date.now());
  if (!room) throw new TypeError("Enter a room name.");

  const redis = getRedis();
  const rateLimitKey = `${ROOM_KEY_TAG}:create-rate:${rateLimitId}`;
  const result = await redis.eval<
    [string, number, number, number, number, string, string],
    unknown
  >(
    CREATE_ROOM_SCRIPT,
    [ROOM_INDEX_KEY, ROOM_METADATA_KEY, rateLimitKey],
    [
      room.id,
      ROOM_EMPTY_GRACE_MS,
      MAX_EPHEMERAL_ROOMS,
      ROOM_CREATION_RATE_LIMIT,
      ROOM_CREATION_RATE_WINDOW_MS,
      JSON.stringify(room),
      ROOM_PARTICIPANT_KEY_PREFIX,
    ],
  );
  const status = readScriptStatus(result);

  if (status === 1) return room;
  if (status === -1) throw new RoomRegistryCapacityError();
  if (status === -2) throw new RoomRegistryRateLimitError();
  throw new RoomRegistryUnavailableError("The room could not be created.");
}

export async function getRegisteredRoomParticipantCount(
  roomId: string,
): Promise<number | null> {
  if (!isValidRoomId(roomId)) return null;

  const redis = getRedis();
  const result = await redis.eval<[string, string], unknown>(
    GET_ROOM_PARTICIPANT_COUNT_SCRIPT,
    [
      ROOM_INDEX_KEY,
      ROOM_METADATA_KEY,
      getRoomParticipantKey(roomId),
    ],
    [roomId, roomId === MAIN_ROOM.id ? "1" : "0"],
  );
  const values = readNumericScriptResult(result, 2);
  if (!values) throw new RoomRegistryUnavailableError();
  if (values[0] === -1) return null;
  if (values[0] !== 1) throw new RoomRegistryUnavailableError();
  return normalizeStoredParticipantCount(values[1]);
}

export async function admitRegisteredRoomParticipant(
  roomId: string,
  participantId: string,
): Promise<number | null> {
  if (!isValidRoomId(roomId)) return null;

  const redis = getRedis();
  const result = await redis.eval<
    [string, string, number, number, number, string],
    unknown
  >(
    ADMIT_ROOM_PARTICIPANT_SCRIPT,
    [
      ROOM_INDEX_KEY,
      ROOM_METADATA_KEY,
      getRoomParticipantKey(roomId),
    ],
    [
      roomId,
      participantId,
      ROOM_PARTICIPANT_CAPACITY,
      ROOM_PARTICIPANT_LEASE_MS,
      ROOM_HEARTBEAT_DEADLINE_MS,
      roomId === MAIN_ROOM.id ? "1" : "0",
    ],
  );
  const values = readNumericScriptResult(result, 3);
  if (!values) throw new RoomRegistryUnavailableError();
  const [status, rawParticipantCount] = values;
  const participantCount =
    normalizeStoredParticipantCount(rawParticipantCount);

  if (status === 1) return participantCount;
  if (status === 0) throw new RoomParticipantCapacityError(participantCount);
  if (status === -1) return null;
  throw new RoomRegistryUnavailableError();
}

export async function leaveRegisteredRoomParticipant(
  roomId: string,
  participantId: string,
): Promise<number> {
  if (!isValidRoomId(roomId)) return 0;

  const redis = getRedis();
  const result = await redis.eval<
    [string, string, number, string],
    unknown
  >(
    LEAVE_ROOM_PARTICIPANT_SCRIPT,
    [
      ROOM_INDEX_KEY,
      ROOM_METADATA_KEY,
      getRoomParticipantKey(roomId),
    ],
    [
      roomId,
      participantId,
      ROOM_EMPTY_GRACE_MS,
      roomId === MAIN_ROOM.id ? "1" : "0",
    ],
  );

  return normalizeStoredParticipantCount(result);
}

function getRedis(): Redis {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  const credentials =
    upstashUrl && upstashToken
      ? { token: upstashToken, url: upstashUrl }
      : kvUrl && kvToken
        ? { token: kvToken, url: kvUrl }
        : null;
  if (!credentials) throw new RoomRegistryUnavailableError();

  redisClient ??= new Redis(credentials);
  return redisClient;
}

function decodeStoredRoom(value: unknown): PublicRoom | null {
  if (typeof value === "string") {
    try {
      return parsePublicRoom(JSON.parse(value));
    } catch {
      return null;
    }
  }

  return parsePublicRoom(value);
}

async function getRoomParticipantCounts(
  rooms: PublicRoom[],
): Promise<number[]> {
  if (rooms.length === 0) return [];

  const redis = getRedis();
  const result = await redis.eval<[], unknown>(
    COUNT_ROOM_PARTICIPANTS_SCRIPT,
    rooms.map((room) => getRoomParticipantKey(room.id)),
    [],
  );
  if (!Array.isArray(result) || result.length !== rooms.length) {
    throw new RoomRegistryUnavailableError();
  }

  return result.map(normalizeStoredParticipantCount);
}

function getRoomParticipantKey(roomId: string): string {
  return `${ROOM_PARTICIPANT_KEY_PREFIX}${roomId}`;
}

function normalizeStoredParticipantCount(value: unknown): number {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw new RoomRegistryUnavailableError();
  }
  return Math.min(ROOM_PARTICIPANT_CAPACITY, count);
}

function readNumericScriptResult(
  value: unknown,
  expectedLength: number,
): number[] | null {
  if (!Array.isArray(value) || value.length < expectedLength) return null;

  const numbers = value.map((item) =>
    typeof item === "number" ? item : Number(item),
  );
  return numbers.every(Number.isFinite) ? numbers : null;
}

function readScriptStatus(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  const status = value[0];
  return typeof status === "number" ? status : Number(status);
}

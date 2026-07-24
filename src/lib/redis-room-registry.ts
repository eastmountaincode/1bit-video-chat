import "server-only";

import { Redis } from "@upstash/redis";

import {
  createPublicRoom,
  getPublicRooms,
  isValidRoomId,
  MAIN_ROOM,
  MAX_PUBLIC_ROOMS,
  parsePublicRoom,
  type PublicRoom,
} from "@/lib/room-directory";
import {
  ROOM_EMPTY_GRACE_MS,
  ROOM_HEARTBEAT_DEADLINE_MS,
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
const ROOM_CREATION_RATE_LIMIT = 5;
const ROOM_CREATION_RATE_WINDOW_MS = 60 * 1_000;
const MAX_EPHEMERAL_ROOMS = MAX_PUBLIC_ROOMS - 1;

const CREATE_ROOM_SCRIPT = `
local time = redis.call("TIME")
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local expired = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", now)
if #expired > 0 then
  redis.call("HDEL", KEYS[2], unpack(expired))
  redis.call("ZREM", KEYS[1], unpack(expired))
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
local expired = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", now)
if #expired > 0 then
  redis.call("HDEL", KEYS[2], unpack(expired))
  redis.call("ZREM", KEYS[1], unpack(expired))
end

local ids = redis.call("ZREVRANGE", KEYS[1], 0, tonumber(ARGV[1]) - 1)
local rooms = {}
for _, id in ipairs(ids) do
  local room = redis.call("HGET", KEYS[2], id)
  if room then
    table.insert(rooms, room)
  else
    redis.call("ZREM", KEYS[1], id)
  end
end
return rooms
`;

const GET_ROOM_SCRIPT = `
local time = redis.call("TIME")
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local deadline = redis.call("ZSCORE", KEYS[1], ARGV[1])
if not deadline or tonumber(deadline) <= now then
  redis.call("ZREM", KEYS[1], ARGV[1])
  redis.call("HDEL", KEYS[2], ARGV[1])
  return nil
end

local room = redis.call("HGET", KEYS[2], ARGV[1])
if not room then
  redis.call("ZREM", KEYS[1], ARGV[1])
  return nil
end
return room
`;

const HEARTBEAT_ROOM_SCRIPT = `
local time = redis.call("TIME")
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local deadline = redis.call("ZSCORE", KEYS[1], ARGV[1])
if not deadline or tonumber(deadline) <= now then
  redis.call("ZREM", KEYS[1], ARGV[1])
  redis.call("HDEL", KEYS[2], ARGV[1])
  return {0, now}
end
if redis.call("HEXISTS", KEYS[2], ARGV[1]) == 0 then
  redis.call("ZREM", KEYS[1], ARGV[1])
  return {0, now}
end

local nextDeadline = now + tonumber(ARGV[2])
redis.call("ZADD", KEYS[1], "XX", "GT", nextDeadline, ARGV[1])
return {1, nextDeadline}
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

export async function listPublicRooms(): Promise<PublicRoom[]> {
  const redis = getRedis();
  const storedRooms = await redis.eval<unknown[], unknown>(
    LIST_ROOMS_SCRIPT,
    [ROOM_INDEX_KEY, ROOM_METADATA_KEY],
    [MAX_EPHEMERAL_ROOMS],
  );
  if (!Array.isArray(storedRooms)) throw new RoomRegistryUnavailableError();

  const decodedRooms = storedRooms.map(decodeStoredRoom);
  if (decodedRooms.some((room) => room === null)) {
    throw new RoomRegistryUnavailableError();
  }

  return getPublicRooms(decodedRooms);
}

export async function getPublicRoom(
  roomId: string,
): Promise<PublicRoom | null> {
  if (roomId === MAIN_ROOM.id) return MAIN_ROOM;
  if (!isValidRoomId(roomId)) return null;

  const redis = getRedis();
  const storedRoom = await redis.eval<[string], unknown>(
    GET_ROOM_SCRIPT,
    [ROOM_INDEX_KEY, ROOM_METADATA_KEY],
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
    [string, number, number, number, number, string],
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
    ],
  );
  const status = readScriptStatus(result);

  if (status === 1) return room;
  if (status === -1) throw new RoomRegistryCapacityError();
  if (status === -2) throw new RoomRegistryRateLimitError();
  throw new RoomRegistryUnavailableError("The room could not be created.");
}

export async function heartbeatRegisteredRoom(
  roomId: string,
): Promise<boolean> {
  if (roomId === MAIN_ROOM.id) return true;
  if (!isValidRoomId(roomId)) return false;

  const redis = getRedis();
  const result = await redis.eval<[string, number], unknown>(
    HEARTBEAT_ROOM_SCRIPT,
    [ROOM_INDEX_KEY, ROOM_METADATA_KEY],
    [roomId, ROOM_HEARTBEAT_DEADLINE_MS],
  );

  const status = readScriptStatus(result);
  if (status === 1) return true;
  if (status === 0) return false;
  throw new RoomRegistryUnavailableError();
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

function readScriptStatus(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  const status = value[0];
  return typeof status === "number" ? status : Number(status);
}

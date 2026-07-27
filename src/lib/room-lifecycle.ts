export const ROOM_EMPTY_GRACE_MS = 2 * 60 * 1_000;
export const ROOM_HEARTBEAT_INTERVAL_MS = 20 * 1_000;
export const ROOM_PARTICIPANT_LEASE_MS = 60 * 1_000;
export const ROOM_HEARTBEAT_DEADLINE_MS =
  ROOM_EMPTY_GRACE_MS + ROOM_HEARTBEAT_INTERVAL_MS;
export const ROOM_LIST_REFRESH_MS = 10 * 1_000;
export const ROOM_PARTICIPANT_ID_LENGTH = 32;

const ROOM_PARTICIPANT_ID_PATTERN = /^[a-f0-9]{32}$/;

export function getCreatedRoomDeadline(now: number): number {
  return now + ROOM_EMPTY_GRACE_MS;
}

export function getHeartbeatRoomDeadline(now: number): number {
  return now + ROOM_HEARTBEAT_DEADLINE_MS;
}

export function isRoomDeadlineActive(
  deadline: number,
  now: number,
): boolean {
  return Number.isSafeInteger(deadline) && deadline > now;
}

export function renewRoomDeadline(
  currentDeadline: number,
  now: number,
): number | null {
  if (!isRoomDeadlineActive(currentDeadline, now)) return null;
  return Math.max(currentDeadline, getHeartbeatRoomDeadline(now));
}

export function isValidRoomParticipantId(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length === ROOM_PARTICIPANT_ID_LENGTH &&
    ROOM_PARTICIPANT_ID_PATTERN.test(value)
  );
}

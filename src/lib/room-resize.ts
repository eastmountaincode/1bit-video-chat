export const ROOM_RESIZE_HANDLE_WIDTH_PX = 1;
export const ROOM_SIDEBAR_MIN_REM = 18;
export const ROOM_VIDEO_MIN_REM = 20;

export interface RoomResizeBounds {
  maxWidth: number;
  minWidth: number;
}

export function getRoomResizeBounds(
  containerWidth: number,
  rootFontSize: number,
): RoomResizeBounds {
  const minWidth = ROOM_SIDEBAR_MIN_REM * rootFontSize;
  const maxWidth = Math.max(
    minWidth,
    containerWidth -
      ROOM_VIDEO_MIN_REM * rootFontSize -
      ROOM_RESIZE_HANDLE_WIDTH_PX,
  );

  return { maxWidth, minWidth };
}

export function clampRoomSidebarWidth(
  width: number,
  bounds: RoomResizeBounds,
) {
  return Math.min(bounds.maxWidth, Math.max(bounds.minWidth, width));
}

export function getDraggedRoomSidebarWidth(
  startWidth: number,
  startClientX: number,
  currentClientX: number,
  bounds: RoomResizeBounds,
) {
  return clampRoomSidebarWidth(
    startWidth + startClientX - currentClientX,
    bounds,
  );
}

"use client";

import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

import {
  clampRoomSidebarWidth,
  getDraggedRoomSidebarWidth,
  getRoomResizeBounds,
  type RoomResizeBounds,
} from "@/lib/room-resize";

interface RoomResizeHandleProps {
  roomShellRef: RefObject<HTMLElement | null>;
}

interface RoomResizeMeasurement extends RoomResizeBounds {
  width: number;
}

interface RoomResizeDrag extends RoomResizeBounds {
  pointerId: number;
  startClientX: number;
  startWidth: number;
}

const DEFAULT_ROOT_FONT_SIZE = 16;

function getRootFontSize() {
  const fontSize = Number.parseFloat(
    window.getComputedStyle(document.documentElement).fontSize,
  );
  return Number.isFinite(fontSize) && fontSize > 0
    ? fontSize
    : DEFAULT_ROOT_FONT_SIZE;
}

function measureRoomResize(
  roomShell: HTMLElement,
): RoomResizeMeasurement | null {
  const sidebar = roomShell.querySelector<HTMLElement>(
    '[data-room-part="sidebar"]',
  );
  if (!sidebar) return null;

  const bounds = getRoomResizeBounds(
    roomShell.getBoundingClientRect().width,
    getRootFontSize(),
  );

  return {
    ...bounds,
    width: clampRoomSidebarWidth(
      sidebar.getBoundingClientRect().width,
      bounds,
    ),
  };
}

export function RoomResizeHandle({
  roomShellRef,
}: RoomResizeHandleProps) {
  const dragRef = useRef<RoomResizeDrag | null>(null);

  useEffect(() => {
    const roomShell = roomShellRef.current;
    if (!roomShell) return;

    return () => {
      delete roomShell.dataset.sidebarResizing;
    };
  }, [roomShellRef]);

  function applyWidth(width: number, bounds: RoomResizeBounds) {
    const roomShell = roomShellRef.current;
    if (!roomShell) return;

    const nextWidth = clampRoomSidebarWidth(width, bounds);
    roomShell.style.setProperty(
      "--room-sidebar-width",
      `${nextWidth}px`,
    );
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;

    const roomShell = roomShellRef.current;
    if (!roomShell) return;

    const nextMeasurement = measureRoomResize(roomShell);
    if (!nextMeasurement) return;

    dragRef.current = {
      maxWidth: nextMeasurement.maxWidth,
      minWidth: nextMeasurement.minWidth,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidth: nextMeasurement.width,
    };
    roomShell.dataset.sidebarResizing = "true";
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function continueResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    applyWidth(
      getDraggedRoomSidebarWidth(
        drag.startWidth,
        drag.startClientX,
        event.clientX,
        drag,
      ),
      drag,
    );
  }

  function stopResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    dragRef.current = null;
    const roomShell = roomShellRef.current;
    if (roomShell) {
      delete roomShell.dataset.sidebarResizing;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      aria-label="resize video and interactive panel"
      aria-orientation="vertical"
      className="room-resize-handle"
      data-room-part="divider"
      onLostPointerCapture={stopResize}
      onPointerCancel={stopResize}
      onPointerDown={startResize}
      onPointerMove={continueResize}
      onPointerUp={stopResize}
      role="separator"
    />
  );
}

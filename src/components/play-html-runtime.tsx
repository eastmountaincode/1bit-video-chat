"use client";

import { playhtml, PlayProvider, usePlayContext } from "@playhtml/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { getPlayHtmlRoomForPath } from "@/lib/room-directory";

const playOptions = {
  // PlayHTML 2.13 treats an options object containing only callbacks as empty.
  // Keeping this explicit value ensures the room callback is registered.
  defaultRoomOptions: { includeSearch: false },
  room: () => getPlayHtmlRoomForPath(window.location.pathname),
};

export function PlayHtmlRuntimeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <PlayProvider initOptions={playOptions} pathname={pathname}>
      <PlayHtmlRoomMarker />
      {children}
    </PlayProvider>
  );
}

function PlayHtmlRoomMarker() {
  const { isLoading } = usePlayContext();
  if (isLoading) return null;

  return (
    <span
      aria-hidden="true"
      className="visually-hidden"
      data-playhtml-room={playhtml.roomId}
    />
  );
}

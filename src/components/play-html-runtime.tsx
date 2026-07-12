"use client";

import { PlayProvider } from "@playhtml/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const playOptions = {
  room: "one-bit-video-chat:main:v1",
};

export function PlayHtmlRuntimeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <PlayProvider initOptions={playOptions} pathname={pathname}>
      {children}
    </PlayProvider>
  );
}

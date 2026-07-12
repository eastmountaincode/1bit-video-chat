"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

const PlayHtmlRuntimeProvider = dynamic(
  () =>
    import("@/components/play-html-runtime").then(
      (module) => module.PlayHtmlRuntimeProvider,
    ),
  {
    ssr: false,
    loading: () => (
      <main className="splash-page">
        <span>...</span>
      </main>
    ),
  },
);

export function PlayHtmlProvider({ children }: { children: ReactNode }) {
  return <PlayHtmlRuntimeProvider>{children}</PlayHtmlRuntimeProvider>;
}

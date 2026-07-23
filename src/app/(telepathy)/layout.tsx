import type { ReactNode } from "react";

import { PlayHtmlProvider } from "@/components/play-html-provider";

export default function TelepathyLayout({ children }: { children: ReactNode }) {
  return <PlayHtmlProvider>{children}</PlayHtmlProvider>;
}

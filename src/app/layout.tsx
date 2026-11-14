import type { Metadata } from "next";
import type { ReactNode } from "react";

import { LayoutDebug } from "@/components/layout-debug";

import "./globals.css";

export const metadata: Metadata = {
  title: "Telepathy",
  description: "Shared low-resolution grayscale video rooms.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
        <body>
            {children}
            <LayoutDebug />
        </body>
    </html>
  );
}

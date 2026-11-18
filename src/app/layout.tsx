import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";

import { LayoutDebug } from "@/components/layout-debug";

import "./globals.css";

export const metadata: Metadata = {
    metadataBase: new URL("https://telepathy.andrew-boylan.com"),
    title: "Telepathy",
    description: "Shared low-resolution grayscale video rooms.",
    openGraph: {
        title: "Telepathy",
        description: "Shared low-resolution grayscale video rooms.",
        siteName: "Telepathy",
        type: "website",
        images: [{
            url: "/open-graph.png",
            width: 1200,
            height: 630,
            alt: "Telepathy",
        }],
    },
    twitter: {
        card: "summary_large_image",
        title: "Telepathy",
        description: "Shared low-resolution grayscale video rooms.",
        images: ["/open-graph.png"],
    },
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en">
            <body>
                {children}
                <Analytics />
                {process.env.NODE_ENV === "development" ? <LayoutDebug /> : null}
            </body>
        </html>
    );
}

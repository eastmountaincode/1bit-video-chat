import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { ImageResponse } from "next/og.js";

async function main() {
    const fontPath = process.argv[2];
    if (!fontPath) {
        throw new Error("Usage: node scripts/generate-open-graph.mjs <Times New Roman.ttf>");
    }

    const root = fileURLToPath(new URL("..", import.meta.url));
    const [font, icon] = await Promise.all([
        fs.readFile(fontPath),
        fs.readFile(path.join(root, "src/app/icon.svg")),
    ]);

    const image = new ImageResponse(
        React.createElement("div", {
            style: {
                alignItems: "center",
                background: "#ffffff",
                color: "#111111",
                display: "flex",
                fontFamily: "Telepathy Times",
                gap: 36,
                height: "100%",
                justifyContent: "center",
                width: "100%",
            },
        },
            React.createElement("img", {
                alt: "",
                height: 150,
                src: `data:image/svg+xml;base64,${icon.toString("base64")}`,
                width: 150,
            }),
            React.createElement("div", {
                style: { display: "flex", fontSize: 120, fontWeight: 400, lineHeight: 1 },
            }, "Telepathy"),
        ),
        {
            fonts: [{ data: font, name: "Telepathy Times", style: "normal", weight: 400 }],
            height: 630,
            width: 1200,
        },
    );

    const output = path.join(root, "public/open-graph.png");
    await fs.writeFile(output, Buffer.from(await image.arrayBuffer()));
    console.log(`Saved ${output} (1200 × 630).`);
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});

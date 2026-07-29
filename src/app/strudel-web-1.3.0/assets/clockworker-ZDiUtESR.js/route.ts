import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-static";

const worker = readFile(
  join(
    process.cwd(),
    "node_modules",
    "@strudel",
    "web",
    "dist",
    "assets",
    "clockworker-ZDiUtESR.js",
  ),
  "utf8",
);

export async function GET() {
  return new Response(await worker, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "text/javascript; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

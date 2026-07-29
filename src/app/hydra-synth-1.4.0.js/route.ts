import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-static";

const bundle = readFile(
  join(
    process.cwd(),
    "node_modules",
    "hydra-synth",
    "dist",
    "hydra-synth.js",
  ),
  "utf8",
);

export async function GET() {
  return new Response(await bundle, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "text/javascript; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

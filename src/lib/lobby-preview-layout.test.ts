import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const globalCss = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("the lobby preview uses one complete border around a fixed frame", () => {
  assert.match(
    globalCss,
    /\.preview-frame\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*3;[^}]*border:\s*1px solid #000000;/s,
  );
  assert.match(
    globalCss,
    /\.preview-frame\s*>\s*\.grayscale-canvas\s*\{[^}]*aspect-ratio:\s*auto;[^}]*height:\s*100%;/s,
  );
  assert.doesNotMatch(globalCss, /\.preview-frame::after/);
});

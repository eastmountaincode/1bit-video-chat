import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { STRUDEL_FRAME_DOCUMENT } from "./strudel-frame-document.ts";

const globalCss = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

const alertSources = [
  "../components/hydra-panel.tsx",
  "../components/join-splash.tsx",
  "../components/room-lobby.tsx",
  "../components/strudel-panel.tsx",
].map((path) => ({
  path,
  source: readFileSync(new URL(path, import.meta.url), "utf8"),
}));

const codePanelSources = ["style", "hydra", "strudel"].map((panel) => ({
  panel,
  source: readFileSync(
    new URL(`../components/${panel}-panel.tsx`, import.meta.url),
    "utf8",
  ),
}));

test("buttons and button-like room links share one visual rule", () => {
  assert.match(
    globalCss,
    /button,\s*\.room-join-link\s*\{[^}]*min-height:\s*1\.75rem;[^}]*padding:\s*0\.125rem 0\.5rem;[^}]*background:\s*#efefef;/s,
  );
  assert.match(
    globalCss,
    /button:active,\s*\.room-join-link:active\s*\{[^}]*background:\s*#dddddd;/s,
  );
  assert.match(
    globalCss,
    /button:disabled,\s*\.room-join-link\[aria-disabled="true"\]\s*\{[^}]*color:\s*#777777;/s,
  );
});

test("every inline alert uses the shared error color", () => {
  for (const { path, source } of alertSources) {
    let alertIndex = source.indexOf('role="alert"');

    while (alertIndex >= 0) {
      const openingTagStart = source.lastIndexOf("<p", alertIndex);
      const openingTag = source.slice(openingTagStart, alertIndex);
      assert.match(openingTag, /className="[^"]*error-note[^"]*"/, path);
      alertIndex = source.indexOf('role="alert"', alertIndex + 1);
    }
  }

  assert.match(
    globalCss,
    /\.error-note\s*\{[^}]*color:\s*#8b0000;/s,
  );
});

test("all three code panels use the same panel, editor, and footer rules", () => {
  for (const { panel, source } of codePanelSources) {
    assert.match(
      source,
      new RegExp(`className="${panel}-panel sidebar-panel"`),
    );
    assert.match(source, new RegExp(`className="${panel}-editor"`));
    assert.match(source, new RegExp(`className="${panel}-panel-footer"`));
  }

  assert.match(
    globalCss,
    /\.style-panel,\s*\.hydra-panel,\s*\.strudel-panel\s*\{[^}]*display:\s*grid;[^}]*gap:\s*0\.5rem;[^}]*grid-template-rows:\s*minmax\(12rem, 1fr\) auto auto;/s,
  );
  assert.match(
    globalCss,
    /\.style-editor,\s*\.hydra-editor,\s*\.strudel-editor\s*\{[^}]*font-family:[^}]*height:\s*100%;[^}]*min-height:\s*12rem;[^}]*resize:\s*none;[^}]*width:\s*100%;/s,
  );
  assert.match(
    globalCss,
    /\.style-panel-footer,\s*\.hydra-panel-footer,\s*\.strudel-panel-footer\s*\{[^}]*align-items:\s*center;[^}]*gap:\s*0\.5rem;[^}]*justify-content:\s*flex-end;/s,
  );
});

test("the isolated Strudel buttons copy the site button metrics", () => {
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /body\s*\{[^}]*font-size:\s*17px;[^}]*line-height:\s*1\.3;/s,
  );
  assert.match(
    STRUDEL_FRAME_DOCUMENT,
    /button\s*\{[^}]*background:\s*#efefef;[^}]*border:\s*1px solid #000;[^}]*min-height:\s*1\.75rem;[^}]*padding:\s*0\.125rem 0\.5rem;/s,
  );
  assert.match(
    globalCss,
    /\.strudel-controls-frame\s*\{[^}]*height:\s*calc\(1\.3em \+ 0\.25rem \+ 2px\);/s,
  );
});

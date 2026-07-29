import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const globalCss = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const roomSidebar = readFileSync(
  new URL("../components/room-sidebar.tsx", import.meta.url),
  "utf8",
);
const videoRoom = readFileSync(
  new URL("../components/video-room.tsx", import.meta.url),
  "utf8",
);

test("the leave button sits with the room panel buttons", () => {
  const tabsStart = roomSidebar.indexOf('<nav');
  const tabsEnd = roomSidebar.indexOf('</nav>', tabsStart);
  const tabsMarkup = roomSidebar.slice(tabsStart, tabsEnd);

  assert.match(tabsMarkup, />\s*leave room\s*</);
  assert.match(tabsMarkup, /data-room-part="leave"/);
  assert.doesNotMatch(videoRoom, />\s*leave room\s*</);
  assert.doesNotMatch(globalCss, /\.leave-button\s*\{/);
});

test("the synth buttons sit between CSS and leave room", () => {
  assert.match(
    roomSidebar,
    /const panels: SidebarPanel\[\] = \[\s*"chat",\s*"settings",\s*"style",\s*"hydra",\s*"strudel",\s*\];/s,
  );

  const hydraPanelIndex = roomSidebar.indexOf("<HydraPanel");
  const strudelPanelIndex = roomSidebar.indexOf("<StrudelPanel");
  const stylePanelIndex = roomSidebar.indexOf("<StylePanel");
  assert.ok(stylePanelIndex >= 0);
  assert.ok(hydraPanelIndex > stylePanelIndex);
  assert.ok(strudelPanelIndex > hydraPanelIndex);
});

test("the in-room sidebar does not repeat the site title", () => {
  assert.doesNotMatch(roomSidebar, />\s*Telepathy\s*</);
  assert.doesNotMatch(globalCss, /\.room-site-title\s*\{/);
});

test("the room name sits right on one row and left when the toolbar wraps", () => {
  assert.match(
    globalCss,
    /\.room-sidebar-toolbar\s*\{[^}]*flex-wrap:\s*wrap-reverse;[^}]*justify-content:\s*space-between;/s,
  );
  assert.match(
    globalCss,
    /\.room-current-name\s*\{[^}]*flex:\s*0\s+1\s+auto;[^}]*text-align:\s*left;/s,
  );
});

test("the closed mobile chat bar matches its fixed-width button", () => {
  assert.match(
    globalCss,
    /\.chat-panel:not\(\.chat-open\)\s+\.chat-control-bar\s*\{[^}]*width:\s*5rem;/s,
  );
  assert.match(
    globalCss,
    /\.chat-toggle-button\s*\{[^}]*flex:\s*0\s+0\s+5rem;/s,
  );
});

test("selected room tabs keep the normal solid button border", () => {
  const selectedTabRule = globalCss.match(
    /\.sidebar-tab\[aria-pressed="true"\]\s*\{([^}]*)\}/s,
  )?.[1];

  assert.ok(selectedTabRule);
  assert.match(selectedTabRule, /background:\s*#dddddd;/);
  assert.doesNotMatch(selectedTabRule, /border-style:/);
});

test("the Strudel control frame matches the shared button box", () => {
  assert.match(
    globalCss,
    /button,\s*\.room-join-link\s*\{[^}]*min-height:\s*1\.75rem;/s,
  );
  assert.match(
    globalCss,
    /\.strudel-controls-frame\s*\{[^}]*height:\s*calc\(1\.3em \+ 0\.25rem \+ 2px\);/s,
  );
});

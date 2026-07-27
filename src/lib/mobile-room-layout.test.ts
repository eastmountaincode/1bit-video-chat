import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const globalCss = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("the leave button reserves space above the video cards", () => {
  const leaveButtonRule = globalCss.match(/\.leave-button\s*\{([^}]*)\}/s)?.[1];

  assert.ok(leaveButtonRule);
  assert.match(leaveButtonRule, /display:\s*block;/);
  assert.match(leaveButtonRule, /margin-left:\s*auto;/);
  assert.doesNotMatch(leaveButtonRule, /position:\s*absolute;/);
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

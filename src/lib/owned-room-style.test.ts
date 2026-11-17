import assert from "node:assert/strict";
import test from "node:test";
import { syncedStore } from "@syncedstore/core";
import * as Y from "yjs";

import { createCollaborativeCodeDocument } from "./collaborative-code.ts";
import { computeTextSplice } from "./collaborative-text.ts";
import { mergeOwnedStyle, hasOwnedStyle, MAX_STORED_ROOM_CSS_LENGTH, prepareOwnedStyle, projectOwnedStyle, renderOwnedStyles, styleOwnerId, type OwnedStyleDocument } from "./owned-room-style.ts";
import { readTextEntries } from "./shared-text-entries.ts";

const alice = styleOwnerId("alice-public-key");
const bob = styleOwnerId("bob-public-key");
const own = '[data-room-part="video-caption"][data-video-side="own"]';
const other = '[data-room-part="video-caption"][data-video-side="other"]';
const initialCss = `body { background: pink; }\n/* My name */\n${own} { color: red; }\n${other} { color: gray; }`;
let sequence = 0;
const prefix = () => `test-${sequence++}`;

function document(css = initialCss): OwnedStyleDocument {
    return createCollaborativeCodeDocument(css, "epoch", 1, MAX_STORED_ROOM_CSS_LENGTH);
}

function edit(doc: OwnedStyleDocument, owner: string, before: string[], after: string) {
    const splice = computeTextSplice(readTextEntries(before), after);
    mergeOwnedStyle(doc, owner, before, splice ? [splice] : [], { start: after.length, end: after.length, direction: "none" }, prefix, MAX_STORED_ROOM_CSS_LENGTH);
}

function renderOwnedStyle(doc: OwnedStyleDocument) { return renderOwnedStyles(doc).map((style) => style.css).join("\n"); }

function target(owner: string) {
    return `[data-style-owner="${owner}"][data-style-owner="${owner}"]`;
}

test("two people edit their own rules independently while room rules remain shared", () => {
    const doc = document();
    prepareOwnedStyle(doc, alice, prefix);
    prepareOwnedStyle(doc, bob, prefix);
    const a = projectOwnedStyle(doc, alice);
    const b = projectOwnedStyle(doc, bob);
    assert.equal(readTextEntries(a).match(/My name/g)?.length, 1);
    assert.equal(readTextEntries(b).match(/My name/g)?.length, 1);
    edit(doc, alice, a, readTextEntries(a).replace("color: red", "color: green"));
    edit(doc, bob, b, readTextEntries(b).replace("color: red", "color: blue").replace("background: pink", "background: white"));
    assert.match(readTextEntries(projectOwnedStyle(doc, alice)), /color: green/);
    assert.doesNotMatch(readTextEntries(projectOwnedStyle(doc, alice)), /color: blue/);
    assert.match(readTextEntries(projectOwnedStyle(doc, alice)), /background: white/);
    assert.match(readTextEntries(projectOwnedStyle(doc, bob)), /color: blue/);
    const rendered = renderOwnedStyle(doc);
    assert.ok(rendered.includes(`${target(alice)} { color: green; }`));
    assert.ok(rendered.includes(`${target(bob)} { color: blue; }`));
    assert.ok(rendered.includes(`:where([data-style-owner]):not([data-style-owner="${alice}"])`));
    assert.doesNotMatch(rendered, /data-video-side/);
});

test("removing own makes that rule shared; deleting your editor does not erase other people's rules", () => {
    const doc = document();
    prepareOwnedStyle(doc, alice, prefix);
    prepareOwnedStyle(doc, bob, prefix);
    const a = projectOwnedStyle(doc, alice);
    edit(doc, alice, a, readTextEntries(a).replace('[data-video-side="own"]', '').replace('color: red', 'color: purple'));
    assert.match(readTextEntries(projectOwnedStyle(doc, bob)), /color: purple/);
    edit(doc, alice, projectOwnedStyle(doc, alice), "");
    assert.match(readTextEntries(projectOwnedStyle(doc, bob)), /color: red/);
    assert.equal(readTextEntries(projectOwnedStyle(doc, alice)), "");
    prepareOwnedStyle(doc, alice, prefix);
    assert.equal(readTextEntries(projectOwnedStyle(doc, alice)), "");
});

test("custom owned chat rules, nested selectors and conditional blocks bind to their writer", () => {
    const css = `@media (width > 1px) { [data-room-part='message-author'][data-message-side = own] { color: red; &:hover { color: green; } } }\n` +
        `[data-room-part="video-card"] { & [data-video-side='other'] { color: blue; } }`;
    const doc = document(css);
    prepareOwnedStyle(doc, alice, prefix);
    const output = renderOwnedStyle(doc);
    assert.ok(output.includes(target(alice)));
    assert.ok(output.includes(`:not([data-style-owner="${alice}"])`));
    assert.match(output, /&:hover \{ color: green;/);
    assert.doesNotMatch(output, /data-message-side|data-video-side/);
});

test("ownership rewriting leaves comments, strings, URLs, custom values and keyframes intact", () => {
    const global = `/* [data-video-side="own"] */\n` +
        `body { content: '[data-message-side="own"]'; background: url("data:image/svg+xml;anything{here}"); --sample: '[data-video-side="other"]'; }\n` +
        `@keyframes blink { from { opacity: 0; } to { opacity: 1; } }`;
    const doc = document(global);
    prepareOwnedStyle(doc, alice, prefix);
    assert.equal(renderOwnedStyle(doc), global);
    assert.equal(readTextEntries(projectOwnedStyle(doc, alice)), global);
    assert.equal(doc.ownership?.template, "");
});

test("a new ad hoc rule binds to its author and incomplete edits keep its identity", () => {
    const doc = document("body { background: white; }");
    prepareOwnedStyle(doc, alice, prefix);
    prepareOwnedStyle(doc, bob, prefix);
    const a = projectOwnedStyle(doc, alice);
    edit(doc, alice, a, readTextEntries(a) + `\n[data-room-part="message-author"][data-message-side="own"] { color: red; }`);
    assert.ok(renderOwnedStyle(doc).includes(target(alice)));
    assert.doesNotMatch(readTextEntries(projectOwnedStyle(doc, bob)), /message-author/);
    const next = projectOwnedStyle(doc, alice);
    edit(doc, alice, next, readTextEntries(next).replace("red; }", "red;"));
    assert.doesNotMatch(readTextEntries(projectOwnedStyle(doc, bob)), /message-author/);
});

test("identity is stable and independent of display names", () => {
    assert.equal(styleOwnerId("same-key"), styleOwnerId("same-key"));
    assert.notEqual(alice, bob);
    assert.match(styleOwnerId('quotes" and \\ Unicode ñ'), /^p-[a-f0-9]+$/);
});

test("unfinished personal CSS stays in a separate stylesheet from everyone else's", () => {
    const doc = document();
    prepareOwnedStyle(doc, alice, prefix);
    prepareOwnedStyle(doc, bob, prefix);
    const a = projectOwnedStyle(doc, alice);
    edit(doc, alice, a, readTextEntries(a) + '\n[data-message-side="own"] { color: green;');
    const styles = renderOwnedStyles(doc);
    assert.ok(styles.find((style) => style.id === alice)?.css.endsWith('color: green;'));
    assert.ok(styles.find((style) => style.id === bob)?.css.endsWith('color: gray; }'));
    assert.equal(styles.find((style) => style.id === 'room')?.css.trim(), 'body { background: pink; }');
});

test("concurrent personal initialization and edits converge over Yjs", () => {
    const seed = document();
    prepareOwnedStyle(seed, alice, prefix);
    const aDoc = new Y.Doc();
    const bDoc = new Y.Doc();
    const a = syncedStore({ state: {} as { current: OwnedStyleDocument } }, aDoc);
    const b = syncedStore({ state: {} as { current: OwnedStyleDocument } }, bDoc);
    a.state.current = seed;
    Y.applyUpdate(bDoc, Y.encodeStateAsUpdate(aDoc));
    const bCurrent = b.state.current;
    assert.ok(bCurrent);
    const av = Y.encodeStateVector(aDoc);
    const bv = Y.encodeStateVector(bDoc);
    const aEntries = projectOwnedStyle(a.state.current, alice);
    edit(a.state.current, alice, aEntries, readTextEntries(aEntries).replace('color: red', 'color: green'));
    prepareOwnedStyle(bCurrent, bob, prefix);
    const bEntries = projectOwnedStyle(bCurrent, bob);
    edit(bCurrent, bob, bEntries, readTextEntries(bEntries).replace('color: red', 'color: blue'));
    const au = Y.encodeStateAsUpdate(aDoc, av);
    const bu = Y.encodeStateAsUpdate(bDoc, bv);
    Y.applyUpdate(aDoc, bu);
    Y.applyUpdate(bDoc, au);
    assert.equal(renderOwnedStyle(a.state.current), renderOwnedStyle(bCurrent));
    assert.ok(renderOwnedStyle(a.state.current).includes(`${target(alice)} { color: green; }`));
    assert.ok(renderOwnedStyle(a.state.current).includes(`${target(bob)} { color: blue; }`));
    assert.ok(hasOwnedStyle(a.state.current, alice));
    assert.ok(hasOwnedStyle(a.state.current, bob));
    aDoc.destroy(); bDoc.destroy();
});

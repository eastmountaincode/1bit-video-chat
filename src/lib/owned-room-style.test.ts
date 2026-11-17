import assert from "node:assert/strict";
import test from "node:test";
import { syncedStore } from "@syncedstore/core";
import * as Y from "yjs";

import { createCollaborativeCodeDocument } from "./collaborative-code.ts";
import { computeTextSplice } from "./collaborative-text.ts";
import { mergeOwnedStyle, hasOwnedStyle, MAX_STORED_ROOM_CSS_LENGTH, normalizeRoomStyleSelectors, prepareOwnedStyle, projectOwnedStyle, renderOwnedStyles, styleOwnerId, type OwnedStyleDocument } from "./owned-room-style.ts";
import { createTextEntries, readTextEntries } from "./shared-text-entries.ts";
import { ROOM_STYLE_SCAFFOLD } from "./room-style.ts";

const alice = styleOwnerId("alice-public-key");
const bob = styleOwnerId("bob-public-key");
const own = '[data-room-part="video-caption"][data-side="own"]';
const other = '[data-room-part="video-caption"][data-side="other"]';
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

test("after reset, pasting an owned video rule keeps the caret after the pasted text", () => {
    const rule = '[data-room-part="video-frame"][data-side="own"] {\n    height: 80px;\n    aspect-ratio: auto;\n}';
    for (const trailing of ["", "\n", "\n\n"]) {
        for (const place of ["start", "middle", "end"]) {
            const doc = document(ROOM_STYLE_SCAFFOLD);
            prepareOwnedStyle(doc, alice, prefix);
            const base = projectOwnedStyle(doc, alice);
            const text = readTextEntries(base);
            const index = place === "start" ? 0 : place === "end" ? text.length : text.indexOf("/* The chat panel. */");
            const insert = rule + trailing;
            const caret = index + insert.length;
            const result = mergeOwnedStyle(doc, alice, base, [{ index, deleteCount: 0, insert }],
                { start: caret, end: caret, direction: "none" }, prefix, 20_000);
            assert.equal(result.text.slice(result.selection.start - insert.length, result.selection.start), insert, `${place}: ${JSON.stringify(trailing)}`);
            assert.equal(result.selection.start, result.selection.end);
        }
    }
});

test("a paste follows its last rule while preserving a concurrent room edit", () => {
    for (const insert of [
        '[data-room-part="video-frame"] { height: 80px; }\n\n',
        '[data-side="own"] { color: red; }\nbody { background: green; }\n\n',
        'body { background: green; }\n[data-side="own"] { color: red; }\n\n',
    ]) {
        const doc = document(ROOM_STYLE_SCAFFOLD);
        prepareOwnedStyle(doc, alice, prefix);
        prepareOwnedStyle(doc, bob, prefix);
        const base = projectOwnedStyle(doc, alice);
        const b = projectOwnedStyle(doc, bob);
        edit(doc, bob, b, readTextEntries(b).replace('[data-room-part="title"] {', '[data-room-part="title"] { color: blue;'));
        const result = mergeOwnedStyle(doc, alice, base, [{ index: base.length, deleteCount: 0, insert }],
            { start: base.length + insert.length, end: base.length + insert.length, direction: "none" }, prefix, 20_000);
        const lastRule = insert.trimEnd().split("\n").at(-1)! + "\n\n";
        assert.equal(result.text.slice(result.selection.start - lastRule.length, result.selection.start), lastRule);
        assert.ok(result.text.includes('[data-room-part="title"] { color: blue;'));
    }
});

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
    assert.doesNotMatch(rendered, /data-side/);
});

test("removing own makes that rule shared; deleting your editor does not erase other people's rules", () => {
    const doc = document();
    prepareOwnedStyle(doc, alice, prefix);
    prepareOwnedStyle(doc, bob, prefix);
    const a = projectOwnedStyle(doc, alice);
    edit(doc, alice, a, readTextEntries(a).replace('[data-side="own"]', '').replace('color: red', 'color: purple'));
    assert.match(readTextEntries(projectOwnedStyle(doc, bob)), /color: purple/);
    edit(doc, alice, projectOwnedStyle(doc, alice), "");
    assert.match(readTextEntries(projectOwnedStyle(doc, bob)), /color: red/);
    assert.equal(readTextEntries(projectOwnedStyle(doc, alice)), "");
    prepareOwnedStyle(doc, alice, prefix);
    assert.equal(readTextEntries(projectOwnedStyle(doc, alice)), "");
});

test("custom owned chat rules, nested selectors and conditional blocks bind to their writer", () => {
    const css = `@media (width > 1px) { [data-room-part='message-author'][data-side = own] { color: red; &:hover { color: green; } } }\n` +
        `[data-room-part="video-card"] { & [data-side='other'] { color: blue; } }`;
    const doc = document(css);
    prepareOwnedStyle(doc, alice, prefix);
    const output = renderOwnedStyle(doc);
    assert.ok(output.includes(target(alice)));
    assert.ok(output.includes(`:not([data-style-owner="${alice}"])`));
    assert.match(output, /&:hover \{ color: green;/);
    assert.doesNotMatch(output, /data-side/);
});

test("ownership rewriting leaves comments, strings, URLs, custom values and keyframes intact", () => {
    const global = `/* [data-side="own"] */\n` +
        `body { content: '[data-side="own"]'; background: url("data:image/svg+xml;anything{here}"); --sample: '[data-side="other"]'; }\n` +
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
    edit(doc, alice, a, readTextEntries(a) + `\n[data-room-part="message-author"][data-side="own"] { color: red; }`);
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

test("data-side targets video and chat parts using the same writer identity", () => {
    const parts = ["video-card", "video-frame", "video-caption", "video-rate", "message", "message-author", "message-time", "message-text"];
    const css = parts.map((part) => `[data-room-part="${part}"][data-side="own"] { color: red; }`).join("\n");
    const doc = document("");
    prepareOwnedStyle(doc, alice, prefix);
    prepareOwnedStyle(doc, bob, prefix);
    edit(doc, alice, projectOwnedStyle(doc, alice), css);
    const rendered = renderOwnedStyle(doc);
    for (const part of parts) assert.ok(rendered.includes(`[data-room-part="${part}"]${target(alice)} { color: red; }`));
    assert.equal(readTextEntries(projectOwnedStyle(doc, bob)), "");
});

test("saved side selectors migrate once for every writer without replacing their character IDs", () => {
    const global = 'body { content: \'[data-video-side="own"]\'; }';
    const personal = `/* [data-message-side="own"] */\n` +
        `[data-room-part="video-card"][data-video-side="own"] { border: 3px solid red; }\n` +
        `@media (width > 1px) { [data-room-part="message-author"][ data-message-side = 'own' ] { color: red; } }\n` +
        `[data-message-side=other] { color: gray; }`;
    const expected = personal.replace('[data-video-side="own"]', '[data-side="own"]')
        .replace("data-message-side = 'own'", "data-side = 'own'").replace('data-message-side=other', 'data-side=other');
    const doc = document(global);
    doc.ownership = {
        template: personal,
        people: {
            [alice]: { entries: createTextEntries(personal, "a") },
            [bob]: { entries: createTextEntries(personal.replaceAll("red", "blue"), "b") },
        },
    };
    const oldEntries = new Set(doc.ownership.people[alice].entries);
    assert.equal(hasOwnedStyle(doc, alice), false);
    prepareOwnedStyle(doc, alice, prefix);
    assert.equal(hasOwnedStyle(doc, bob), true);
    assert.equal(doc.id, "epoch");
    assert.equal(readTextEntries(doc.entries), global);
    assert.equal(doc.ownership.template, expected);
    assert.equal(readTextEntries(doc.ownership.people[alice].entries), expected);
    assert.equal(readTextEntries(doc.ownership.people[bob].entries), expected.replaceAll("red", "blue"));
    assert.ok(doc.ownership.people[alice].entries.every((entry) => oldEntries.has(entry)));
    const snapshot = JSON.stringify(doc);
    prepareOwnedStyle(doc, bob, prefix);
    assert.equal(JSON.stringify(doc), snapshot);

    // The old spelling is not a supported alias for newly entered CSS.
    const before = projectOwnedStyle(doc, alice);
    edit(doc, alice, before, readTextEntries(before) + '\n[data-video-side="own"] { opacity: 0.5; }');
    assert.ok(readTextEntries(doc.entries).includes('[data-video-side="own"] { opacity: 0.5; }'));
    assert.equal(normalizeRoomStyleSelectors(expected), expected);
});

test("two clients migrating the saved selectors concurrently converge without losing declarations", () => {
    const aDoc = new Y.Doc();
    const bDoc = new Y.Doc();
    const a = syncedStore({ state: {} as { current: OwnedStyleDocument } }, aDoc);
    const b = syncedStore({ state: {} as { current: OwnedStyleDocument } }, bDoc);
    const legacy = '[data-room-part="message-author"][data-message-side="own"] { font-size: 2em; color: red; }';
    const seed = document("");
    seed.ownership = { template: legacy, people: {
        [alice]: { entries: createTextEntries(legacy, "a") },
        [bob]: { entries: createTextEntries(legacy.replace("red", "blue"), "b") },
    } };
    a.state.current = seed;
    Y.applyUpdate(bDoc, Y.encodeStateAsUpdate(aDoc));
    prepareOwnedStyle(a.state.current, alice, prefix);
    prepareOwnedStyle(b.state.current, bob, prefix);
    const au = Y.encodeStateAsUpdate(aDoc);
    const bu = Y.encodeStateAsUpdate(bDoc);
    Y.applyUpdate(aDoc, bu);
    Y.applyUpdate(bDoc, au);
    assert.equal(renderOwnedStyle(a.state.current), renderOwnedStyle(b.state.current));
    for (const doc of [a.state.current, b.state.current]) {
        assert.equal(readTextEntries(doc.ownership!.people[alice].entries), legacy.replace("data-message-side", "data-side"));
        assert.equal(readTextEntries(doc.ownership!.people[bob].entries), legacy.replace("data-message-side", "data-side").replace("red", "blue"));
    }
    aDoc.destroy();
    bDoc.destroy();
});

test("unfinished personal CSS stays in a separate stylesheet from everyone else's", () => {
    const doc = document();
    prepareOwnedStyle(doc, alice, prefix);
    prepareOwnedStyle(doc, bob, prefix);
    const a = projectOwnedStyle(doc, alice);
    edit(doc, alice, a, readTextEntries(a) + '\n[data-side="own"] { color: green;');
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

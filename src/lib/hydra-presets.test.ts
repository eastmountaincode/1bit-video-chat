import assert from "node:assert/strict";
import test from "node:test";
import { Script } from "node:vm";

import { HYDRA_EXAMPLES } from "./hydra-examples.ts";
import { chooseHydraSketchId, getInitialRoomHydra } from "./hydra-presets.ts";
import { chooseRandomHydraCode, formatHydraExample } from "./hydra-randomizer.ts";
import { createPublicRoomListing, parsePublicRoom, parsePublicRoomListing } from "./room-directory.ts";
import { DEFAULT_ROOM_HYDRA, MAX_HYDRA_CODE_LENGTH } from "./room-hydra.ts";

test("room starters survive storage and directory parsing and remain off", () => {
    const ids = new Set(HYDRA_EXAMPLES.map((sketch) => sketch.id));
    assert.equal(ids.size, HYDRA_EXAMPLES.length);
    assert.ok(ids.has(chooseHydraSketchId()));

    for (const sketch of HYDRA_EXAMPLES) {
        const room = { id: "new-room", name: "New room", createdAt: 1000, hydraSketchId: sketch.id };
        const stored = parsePublicRoom(JSON.parse(JSON.stringify(room)), 2000);
        assert.deepEqual(stored, room);
        const listing = parsePublicRoomListing(createPublicRoomListing(stored!, 0), 2000);
        assert.equal(listing?.hydraSketchId, sketch.id);

        const initial = getInitialRoomHydra(stored!.hydraSketchId);
        assert.equal(initial.enabled, false);
        assert.equal(initial.updatedAt, 0);
        assert.ok(initial.code.endsWith(sketch.code));
        assert.ok(initial.code.includes(`https://hydra.ojack.xyz/?sketch_id=${sketch.id}`));
        assert.match(initial.code, /CC BY-NC-SA 4\.0/);
        assert.ok(initial.code.length <= MAX_HYDRA_CODE_LENGTH);
        assert.deepEqual(getInitialRoomHydra(listing?.hydraSketchId), initial);
        assert.doesNotMatch(sketch.code, /\ba\.fft\b|\ba\.setSmooth\b|\bs[0-3]\b/);
        assert.doesNotThrow(() => new Script(initial.code, { filename: sketch.id }));
    }
});

test("legacy rooms keep their original default without inventing a stored sketch", () => {
    const legacy = { id: "old-room", name: "Old room", createdAt: 1000 };
    assert.deepEqual(parsePublicRoom(legacy, 2000), legacy);
    assert.deepEqual(getInitialRoomHydra(), DEFAULT_ROOM_HYDRA);
    assert.deepEqual(getInitialRoomHydra("unknown_sketch"), DEFAULT_ROOM_HYDRA);
    assert.deepEqual(parsePublicRoom({ ...legacy, hydraSketchId: "bad/id" }, 2000), legacy);
    assert.deepEqual(parsePublicRoom({ ...legacy, hydraSketchId: 42 }, 2000), legacy);
});

test("randomization reaches every starter, retains credits, and avoids repeating the current sketch", () => {
    for (const [index, sketch] of HYDRA_EXAMPLES.entries()) {
        const selected = chooseRandomHydraCode("custom sketch", () => (index + 0.5) / HYDRA_EXAMPLES.length);
        assert.equal(selected, formatHydraExample(sketch));
        assert.ok(selected.length <= MAX_HYDRA_CODE_LENGTH);
        assert.notEqual(chooseRandomHydraCode(selected, () => 0), selected);
        assert.notEqual(chooseRandomHydraCode(sketch.code, () => 0), selected);
    }
});

import assert from "node:assert/strict";
import test from "node:test";

import { preventMobileInputScroll } from "./mobile-input-focus.ts";

function setup() {
    const target = new EventTarget();
    const document: { activeElement: EventTarget | null } = { activeElement: null };
    const focusCalls: FocusOptions[] = [];
    const input = Object.assign(target, {
        ownerDocument: document,
        disabled: false,
        focus(options: FocusOptions) {
            focusCalls.push(options);
            document.activeElement = target;
        },
    });
    const dispose = preventMobileInputScroll(input as unknown as HTMLInputElement);

    function touch(type: string, points = [{ identifier: 1, clientX: 20, clientY: 700 }], options: { cancelable?: boolean; prevented?: boolean } = {}) {
        const event = new Event(type, { cancelable: options.cancelable ?? true });
        Object.assign(event, { touches: type === "touchend" ? [] : points, changedTouches: points });
        if (options.prevented) event.preventDefault();
        input.dispatchEvent(event);
        return event;
    }

    return { input, document, focusCalls, touch, dispose };
}

test("the first tap focuses the input without native page scrolling", () => {
    const { input, document, focusCalls, touch, dispose } = setup();
    touch("touchstart");
    assert.equal(touch("touchend").defaultPrevented, true);
    assert.equal(document.activeElement, input);
    assert.deepEqual(focusCalls, [{ preventScroll: true }]);
    dispose();
});

test("focused input taps keep native caret placement and selection", () => {
    const { input, document, focusCalls, touch, dispose } = setup();
    document.activeElement = input;
    touch("touchstart");
    assert.equal(touch("touchend").defaultPrevented, false);
    assert.equal(focusCalls.length, 0);
    dispose();
});

test("dragging across the input does not focus it, even when the finger returns", () => {
    const { focusCalls, touch, dispose } = setup();
    touch("touchstart");
    touch("touchmove", [{ identifier: 1, clientX: 20, clientY: 650 }]);
    assert.equal(touch("touchend").defaultPrevented, false);
    // Also reject movement first observed at touchend.
    touch("touchstart");
    assert.equal(touch("touchend", [{ identifier: 1, clientX: 45, clientY: 700 }]).defaultPrevented, false);
    assert.equal(focusCalls.length, 0);
    dispose();
});

test("canceled gestures and multiple fingers retain native behavior", () => {
    const { focusCalls, touch, dispose } = setup();
    touch("touchstart");
    touch("touchcancel");
    assert.equal(touch("touchend").defaultPrevented, false);
    touch("touchstart");
    touch("touchstart", [
        { identifier: 1, clientX: 20, clientY: 700 },
        { identifier: 2, clientX: 40, clientY: 700 },
    ]);
    assert.equal(touch("touchend").defaultPrevented, false);
    touch("touchstart");
    assert.equal(touch("touchend", [{ identifier: 2, clientX: 20, clientY: 700 }]).defaultPrevented, false);
    assert.equal(focusCalls.length, 0);
    dispose();
});

test("disabled inputs and canceled or noncancelable events never force focus", () => {
    const { input, focusCalls, touch, dispose } = setup();
    input.disabled = true;
    touch("touchstart");
    assert.equal(touch("touchend").defaultPrevented, false);
    input.disabled = false;
    touch("touchstart");
    touch("touchend", undefined, { prevented: true });
    touch("touchstart");
    assert.equal(touch("touchend", undefined, { cancelable: false }).defaultPrevented, false);
    assert.equal(focusCalls.length, 0);
    dispose();
});

test("a later tap after blur uses the same scroll-free focus", () => {
    const { document, focusCalls, touch, dispose } = setup();
    touch("touchstart");
    touch("touchend");
    document.activeElement = null;
    touch("touchstart");
    assert.equal(touch("touchend").defaultPrevented, true);
    assert.deepEqual(focusCalls, [{ preventScroll: true }, { preventScroll: true }]);
    dispose();
});

test("cleanup removes touch handling from the input", () => {
    const { focusCalls, touch, dispose } = setup();
    dispose();
    touch("touchstart");
    assert.equal(touch("touchend").defaultPrevented, false);
    assert.equal(focusCalls.length, 0);
});

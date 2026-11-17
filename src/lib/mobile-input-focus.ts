// Handle the initial tap ourselves so Safari does not also pan the page toward
// the input while the chat follows the keyboard. Already-focused inputs keep
// native caret placement and selection behavior.
export function preventMobileInputScroll(input: HTMLInputElement): () => void {
    let start: { id: number; x: number; y: number } | null = null;

    function onStart(event: TouchEvent) {
        start = null;
        if (event.touches.length !== 1 || input.ownerDocument.activeElement === input) return;
        const touch = event.touches[0];
        start = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
    }

    function moved(touch: Touch) {
        return !start || touch.identifier !== start.id ||
            Math.abs(touch.clientX - start.x) > 10 || Math.abs(touch.clientY - start.y) > 10;
    }

    function onMove(event: TouchEvent) {
        if (event.touches.length !== 1 || moved(event.touches[0])) start = null;
    }

    function onEnd(event: TouchEvent) {
        const isTap = start && event.changedTouches.length === 1 && !moved(event.changedTouches[0]);
        start = null;
        if (!isTap || !event.cancelable || event.defaultPrevented || input.disabled ||
            input.ownerDocument.activeElement === input) return;
        event.preventDefault();
        input.focus({ preventScroll: true });
    }

    function cancel() {
        start = null;
    }

    // React delegates touch events passively, so register the cancelable handler
    // directly on this input rather than changing touch behavior for the page.
    input.addEventListener("touchstart", onStart, { passive: true });
    input.addEventListener("touchmove", onMove, { passive: true });
    input.addEventListener("touchend", onEnd, { passive: false });
    input.addEventListener("touchcancel", cancel, { passive: true });

    return () => {
        input.removeEventListener("touchstart", onStart);
        input.removeEventListener("touchmove", onMove);
        input.removeEventListener("touchend", onEnd);
        input.removeEventListener("touchcancel", cancel);
    };
}

"use client";

import { useEffect } from "react";

export function LayoutDebug() {
    useEffect(() => {
        function toggleOutlines(event: KeyboardEvent) {
            if (event.key.toLowerCase() !== "b" || event.repeat || event.isComposing ||
                event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;

            const target = event.target;
            if (target instanceof Element && target.closest(
                'input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])',
            )) return;

            document.documentElement.toggleAttribute("data-layout-debug");
        }

        window.addEventListener("keydown", toggleOutlines);
        return () => {
            window.removeEventListener("keydown", toggleOutlines);
            document.documentElement.removeAttribute("data-layout-debug");
        };
    }, []);

    return null;
}

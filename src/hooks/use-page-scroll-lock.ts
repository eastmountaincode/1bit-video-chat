"use client";

import { useLayoutEffect } from "react";

export function usePageScrollLock(locked: boolean) {
    useLayoutEffect(() => {
        if (!locked) return;

        const { scrollX, scrollY } = window;
        const body = document.body;
        const root = document.documentElement;
        const changes: [HTMLElement, Record<string, string>][] = [
            [body, {
                position: "fixed",
                top: `${-scrollY}px`,
                left: `${-scrollX}px`,
                width: "100%",
                overflow: "hidden",
            }],
            [root, { overflow: "hidden", "overscroll-behavior": "none" }],
        ];
        const previous = changes.flatMap(([element, properties]) =>
            Object.entries(properties).map(([property, value]) => {
                const saved = {
                    element,
                    property,
                    value: element.style.getPropertyValue(property),
                    priority: element.style.getPropertyPriority(property),
                };
                element.style.setProperty(property, value);
                return saved;
            }),
        );

        return () => {
            for (const { element, property, value, priority } of previous) {
                if (value) element.style.setProperty(property, value, priority);
                else element.style.removeProperty(property);
            }
            window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
        };
    }, [locked]);
}

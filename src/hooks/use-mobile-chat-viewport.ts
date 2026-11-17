"use client";

import { useLayoutEffect, type RefObject } from "react";

import { getMobileChatViewport } from "@/lib/mobile-chat-viewport";

export function useMobileChatViewport(panelRef: RefObject<HTMLElement | null>, enabled: boolean) {
    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (!enabled || !panel) return;

        const viewport = window.visualViewport;
        let frame: number | null = null;
        function update() {
            frame = null;
            const { height, bottom } = getMobileChatViewport(window.innerHeight, viewport);
            panel!.style.setProperty("--chat-viewport-height", `${height}px`);
            panel!.style.setProperty("--chat-viewport-bottom", `${bottom}px`);
        }
        function schedule() {
            if (frame === null) frame = window.requestAnimationFrame(update);
        }

        update();
        viewport?.addEventListener("resize", schedule);
        viewport?.addEventListener("scroll", schedule);
        window.addEventListener("resize", schedule);

        return () => {
            if (frame !== null) window.cancelAnimationFrame(frame);
            viewport?.removeEventListener("resize", schedule);
            viewport?.removeEventListener("scroll", schedule);
            window.removeEventListener("resize", schedule);
            panel.style.removeProperty("--chat-viewport-height");
            panel.style.removeProperty("--chat-viewport-bottom");
        };
    }, [enabled, panelRef]);
}

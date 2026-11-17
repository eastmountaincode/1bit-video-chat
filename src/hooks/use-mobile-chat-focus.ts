"use client";

import { useEffect, type RefObject } from "react";

import { preventMobileInputScroll } from "@/lib/mobile-input-focus";

export function useMobileChatFocus(inputRef: RefObject<HTMLInputElement | null>, enabled: boolean) {
    useEffect(() => {
        const input = inputRef.current;
        if (!enabled || !input) return;
        return preventMobileInputScroll(input);
    }, [enabled, inputRef]);
}

interface VisibleViewport {
    height: number;
    offsetTop: number;
}

export function getMobileChatViewport(layoutHeight: number, viewport?: VisibleViewport | null) {
    const height = Math.min(layoutHeight, Math.max(0, viewport?.height ?? layoutHeight));
    const offsetTop = Math.max(0, viewport?.offsetTop ?? 0);
    return {
        height,
        bottom: Math.max(0, layoutHeight - height - offsetTop),
    };
}

interface VisibleViewport {
    height: number;
    offsetTop: number;
}

export function getMobileChatViewport(fallbackHeight: number, viewport?: VisibleViewport | null) {
    const height = Math.max(0, viewport?.height ?? fallbackHeight);
    const offsetTop = Math.max(0, viewport?.offsetTop ?? 0);
    return {
        height,
        // Position from the top of the layout viewport. Safari's fixed bottom
        // edge does not always match innerHeight while its toolbar is moving.
        bottomEdge: offsetTop + height,
    };
}

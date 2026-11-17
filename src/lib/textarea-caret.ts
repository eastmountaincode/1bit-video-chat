// Textareas do not expose the caret's bounds. Measure a matching, invisible text
// block only when a local edit is rearranged by the collaborative document.
export function revealTextareaCaret(textarea: HTMLTextAreaElement): void {
    const document = textarea.ownerDocument;
    const window = document.defaultView;
    if (!window || document.activeElement !== textarea || textarea.clientHeight === 0) return;

    const computed = window.getComputedStyle(textarea);
    const mirror = document.createElement("div");
    mirror.style.all = "initial";
    mirror.style.display = "block";
    for (const property of [
        "box-sizing", "font-family", "font-size", "font-weight", "font-style",
        "font-variant", "font-stretch", "line-height", "letter-spacing", "word-spacing",
        "text-transform", "text-indent", "text-align", "tab-size", "direction",
        "padding-top", "padding-right", "padding-bottom", "padding-left",
        "word-break", "overflow-wrap",
    ]) {
        mirror.style.setProperty(property, computed.getPropertyValue(property));
    }
    // clientWidth excludes borders and the scrollbar but includes padding.
    mirror.style.boxSizing = "border-box";
    mirror.style.width = `${textarea.clientWidth}px`;
    mirror.style.position = "fixed";
    mirror.style.left = "-100000px";
    mirror.style.top = "0";
    mirror.style.visibility = "hidden";
    mirror.style.pointerEvents = "none";
    mirror.style.whiteSpace = textarea.wrap === "off" ? "pre" : "pre-wrap";
    mirror.style.overflowWrap = textarea.wrap === "off" ? "normal" : "break-word";
    mirror.setAttribute("aria-hidden", "true");

    const caret = textarea.selectionDirection === "backward" ? textarea.selectionStart : textarea.selectionEnd;
    mirror.textContent = textarea.value.slice(0, caret);
    const marker = document.createElement("span");
    marker.style.all = "unset";
    marker.textContent = textarea.value.slice(caret) || ".";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);

    try {
        const top = marker.offsetTop;
        const left = marker.offsetLeft;
        const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.2;
        if (top < textarea.scrollTop) textarea.scrollTop = top;
        else if (top + lineHeight > textarea.scrollTop + textarea.clientHeight) {
            textarea.scrollTop = top + lineHeight - textarea.clientHeight;
        }
        if (computed.direction !== "rtl") {
            if (left < textarea.scrollLeft) textarea.scrollLeft = left;
            else if (left + 1 > textarea.scrollLeft + textarea.clientWidth) {
                textarea.scrollLeft = left + 1 - textarea.clientWidth;
            }
        }
    } finally {
        mirror.remove();
    }
}

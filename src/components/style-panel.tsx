"use client";

import { usePageData, usePlayContext } from "@playhtml/react";
import { memo, useId, useMemo } from "react";

import { useCollaborativeCodeEditor, type CodeDocumentAdapter } from "@/hooks/use-collaborative-code-editor";
import { DEFAULT_COLLABORATIVE_CODE_DATA } from "@/lib/collaborative-code";
import {
    mergeOwnedStyle,
    hasOwnedStyle,
    MAX_STORED_ROOM_CSS_LENGTH,
    OWNED_ROOM_STYLE_CHANNEL,
    prepareOwnedStyle,
    projectOwnedStyle,
    renderOwnedStyles,
} from "@/lib/owned-room-style";
import {
    DEFAULT_COLLABORATIVE_ROOM_STYLE,
    DEFAULT_ROOM_STYLE,
    getCollaborativeRoomStyleCss,
    MAX_ROOM_CSS_LENGTH,
    ROOM_STYLE_SCAFFOLD,
    type CollaborativeRoomStyleData,
    type RoomStyleData,
} from "@/lib/room-style";

interface StylePanelProps {
    active: boolean;
    name: string;
    ownerId: string;
}

export const StylePanel = memo(function StylePanel({ active, name, ownerId }: StylePanelProps) {
    const editorInstructionsId = useId();
    const { isLoading } = usePlayContext();
    // Import once into the identity-aware document; older tabs cannot overwrite it.
    const [legacyStyle] = usePageData<RoomStyleData>("room-style:v1", DEFAULT_ROOM_STYLE);
    const [legacyDocument] = usePageData<CollaborativeRoomStyleData>("room-style:v2", DEFAULT_COLLABORATIVE_ROOM_STYLE);
    const initialCode = getCollaborativeRoomStyleCss(legacyDocument, legacyStyle.css ?? ROOM_STYLE_SCAFFOLD);
    const documentAdapter = useMemo<CodeDocumentAdapter>(() => ({
        initialize: (document) => prepareOwnedStyle(document, ownerId, () => `o${crypto.randomUUID()}`),
        ready: (document) => hasOwnedStyle(document, ownerId),
        project: (document) => projectOwnedStyle(document, ownerId),
        merge: (document, base, splices, selection, prefix, maxLength) => mergeOwnedStyle(document, ownerId, base, splices, selection, prefix, maxLength),
    }), [ownerId]);
    const editor = useCollaborativeCodeEditor({
        channelName: OWNED_ROOM_STYLE_CHANNEL,
        defaultData: DEFAULT_COLLABORATIVE_CODE_DATA,
        disabled: isLoading || !ownerId,
        documentAdapter,
        entryPrefix: "s",
        initialCode,
        maxLength: MAX_ROOM_CSS_LENGTH,
        maxStoredLength: MAX_STORED_ROOM_CSS_LENGTH,
        name,
    });
    const current = editor.sharedDocument.current;
    const sharedStyles = current ? renderOwnedStyles(current) : [];

    return (
        <>
            {sharedStyles.map((style) => <style data-telepathy-room-style key={style.id}>{style.css}</style>)}
            <fieldset className="style-panel sidebar-panel" data-room-part="style" hidden={!active}>
                <legend>css</legend>
                <textarea
                    aria-describedby={editorInstructionsId}
                    aria-label="room css"
                    autoCapitalize="off"
                    autoComplete="off"
                    autoCorrect="off"
                    className="style-editor"
                    disabled={editor.editorDisabled}
                    maxLength={MAX_ROOM_CSS_LENGTH}
                    onBlur={editor.handleBlur}
                    onChange={editor.handleChange}
                    onCompositionEnd={editor.handleCompositionEnd}
                    onCompositionStart={editor.handleCompositionStart}
                    onKeyDown={editor.handleKeyDown}
                    onSelect={editor.handleSelect}
                    ref={editor.textareaRef}
                    spellCheck={false}
                    value={editor.editorValue}
                />
                <span className="visually-hidden" id={editorInstructionsId}>
                    Enter keeps the current indentation and adds one level after an
                    opening brace. Tab indents; Shift+Tab outdents. Press Escape, then
                    Tab to leave the editor.
                </span>
                <div className="style-panel-footer">
                    <button disabled={editor.editorDisabled} onClick={() => editor.replaceCode(ROOM_STYLE_SCAFFOLD)} type="button">
                        reset room style
                    </button>
                </div>
            </fieldset>
        </>
    );
});

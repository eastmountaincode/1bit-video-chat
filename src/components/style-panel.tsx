"use client";

import { playhtml, usePageData, usePlayContext } from "@playhtml/react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";

import {
  applyTextSplice,
  computeTextSplice,
  mapSelectionThroughTextChanges,
  rebaseTextSpliceOntoText,
  type TextSelection,
  type TextSplice,
} from "@/lib/collaborative-text";
import {
  DEFAULT_COLLABORATIVE_ROOM_STYLE,
  DEFAULT_ROOM_STYLE,
  ensureRoomStyleScaffold,
  MAX_ROOM_CSS_LENGTH,
  ROOM_STYLE_SCAFFOLD,
  type CollaborativeRoomStyleData,
  type RoomStyleData,
} from "@/lib/room-style";
import { changeTextIndentation } from "@/lib/text-indentation";

interface StylePanelProps {
  active: boolean;
  name: string;
}

function readSelection(textarea: HTMLTextAreaElement): TextSelection {
  return {
    start: textarea.selectionStart,
    end: textarea.selectionEnd,
    direction: textarea.selectionDirection,
  };
}

function clampSelection(
  selection: TextSelection,
  textLength: number,
): TextSelection {
  const start = Math.min(selection.start, textLength);
  const end = Math.max(start, Math.min(selection.end, textLength));

  return { ...selection, start, end };
}

export function StylePanel({ active, name }: StylePanelProps) {
  const editorInstructionsId = useId();
  const [legacyStyle] = usePageData<RoomStyleData>(
    "room-style:v1",
    DEFAULT_ROOM_STYLE,
  );
  const [sharedDocument, setSharedDocument] =
    usePageData<CollaborativeRoomStyleData>(
      "room-style:v2",
      DEFAULT_COLLABORATIVE_ROOM_STYLE,
    );
  const { isLoading } = usePlayContext();
  const sharedChars = Array.isArray(sharedDocument.chars)
    ? sharedDocument.chars
    : null;
  const hasSharedDocument = sharedChars !== null;
  const legacyCss = ensureRoomStyleScaffold(
    typeof legacyStyle.css === "string" ? legacyStyle.css : ROOM_STYLE_SCAFFOLD,
  );
  const sharedCss = sharedChars ? sharedChars.join("") : legacyCss;
  const [editorValue, setEditorValue] = useState(ROOM_STYLE_SCAFFOLD);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorValueRef = useRef(ROOM_STYLE_SCAFFOLD);
  const selectionRef = useRef<TextSelection>({
    start: 0,
    end: 0,
    direction: "none",
  });
  const pendingSelectionRef = useRef<TextSelection | null>(null);
  const isComposingRef = useRef(false);
  const compositionBaseRef = useRef(ROOM_STYLE_SCAFFOLD);
  const compositionFinalValueRef = useRef<string | null>(null);
  const compositionResultRef = useRef<string | null>(null);
  const allowNextTabToLeaveRef = useRef(false);

  useEffect(() => {
    if (isLoading || hasSharedDocument) return;

    const legacyChannel = playhtml.createPageData<RoomStyleData>(
      "room-style:v1",
      DEFAULT_ROOM_STYLE,
    );
    const liveLegacyStyle = legacyChannel.getData();
    legacyChannel.destroy();
    const source = {
      css: ensureRoomStyleScaffold(
        typeof liveLegacyStyle.css === "string"
          ? liveLegacyStyle.css
          : ROOM_STYLE_SCAFFOLD,
      ),
      updatedAt: liveLegacyStyle.updatedAt,
      updatedBy: liveLegacyStyle.updatedBy,
    };

    setSharedDocument((draft) => {
      if (Array.isArray(draft.chars)) return;

      draft.chars = source.css.split("");
      draft.updatedAt = source.updatedAt;
      draft.updatedBy = source.updatedBy;
      draft.version = 2;
    });
  }, [hasSharedDocument, isLoading, setSharedDocument]);

  useLayoutEffect(() => {
    if (!hasSharedDocument || isComposingRef.current) return;

    const previousValue = editorValueRef.current;
    if (previousValue === sharedCss) return;

    const textarea = textareaRef.current;
    const currentSelection =
      textarea && document.activeElement === textarea
        ? readSelection(textarea)
        : selectionRef.current;
    const nextSelection = mapSelectionThroughTextChanges(
      previousValue,
      sharedCss,
      currentSelection,
    );

    editorValueRef.current = sharedCss;
    selectionRef.current = clampSelection(nextSelection, sharedCss.length);
    pendingSelectionRef.current = selectionRef.current;
    setEditorValue(sharedCss);
  }, [hasSharedDocument, sharedCss]);

  useLayoutEffect(() => {
    const pendingSelection = pendingSelectionRef.current;
    const textarea = textareaRef.current;
    pendingSelectionRef.current = null;

    if (
      !pendingSelection ||
      !textarea ||
      document.activeElement !== textarea
    ) {
      return;
    }

    textarea.setSelectionRange(
      pendingSelection.start,
      pendingSelection.end,
      pendingSelection.direction,
    );
  }, [editorValue]);

  function updateEditor(value: string, selection: TextSelection) {
    const nextSelection = clampSelection(selection, value.length);
    editorValueRef.current = value;
    selectionRef.current = nextSelection;
    pendingSelectionRef.current = nextSelection;
    setEditorValue(value);
  }

  function commitSplices(before: string, localSplices: TextSplice[]) {
    if (isLoading || !hasSharedDocument) return before;

    let mergedText = before;

    setSharedDocument((draft) => {
      if (!Array.isArray(draft.chars)) return;

      let intendedText = before;
      let nextText = draft.chars.join("");
      let didChange = false;

      for (const localSplice of localSplices) {
        const rebasedSplices =
          intendedText === nextText
            ? [localSplice]
            : rebaseTextSpliceOntoText(
                intendedText,
                nextText,
                localSplice,
                { insertAffinity: "after" },
              );

        for (const rebasedSplice of rebasedSplices) {
          const index = Math.min(rebasedSplice.index, nextText.length);
          const deleteCount = Math.min(
            rebasedSplice.deleteCount,
            nextText.length - index,
          );
          const availableInsertLength = Math.max(
            0,
            MAX_ROOM_CSS_LENGTH - (nextText.length - deleteCount),
          );
          const insert = rebasedSplice.insert.slice(0, availableInsertLength);

          if (deleteCount === 0 && insert.length === 0) continue;

          const appliedSplice = { index, deleteCount, insert };
          draft.chars.splice(index, deleteCount, ...insert.split(""));
          nextText = applyTextSplice(nextText, appliedSplice);
          didChange = true;
        }

        intendedText = applyTextSplice(intendedText, localSplice);
      }

      if (didChange) {
        draft.updatedAt = Date.now();
        draft.updatedBy = name;
        draft.version = 2;
      }
      mergedText = nextText;
    });

    return mergedText;
  }

  function commitEdit(before: string, after: string) {
    const localSplice = computeTextSplice(before, after);
    return commitSplices(before, localSplice ? [localSplice] : []);
  }

  function handleEditorChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.currentTarget.value;
    const nextSelection = readSelection(event.currentTarget);

    if (
      !isComposingRef.current &&
      compositionFinalValueRef.current === nextValue
    ) {
      const compositionResult =
        compositionResultRef.current ?? editorValueRef.current;
      compositionFinalValueRef.current = null;
      compositionResultRef.current = null;
      updateEditor(compositionResult, selectionRef.current);
      return;
    }

    compositionFinalValueRef.current = null;
    compositionResultRef.current = null;

    if (isComposingRef.current) {
      updateEditor(nextValue, nextSelection);
      return;
    }

    const mergedText = commitEdit(editorValueRef.current, nextValue);
    const mergedSelection = mapSelectionThroughTextChanges(
      nextValue,
      mergedText,
      nextSelection,
    );

    updateEditor(mergedText, mergedSelection);
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      allowNextTabToLeaveRef.current = true;
      return;
    }

    if (event.key !== "Tab") {
      if (!["Alt", "Control", "Meta", "Shift"].includes(event.key)) {
        allowNextTabToLeaveRef.current = false;
      }
      return;
    }

    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing ||
      isComposingRef.current
    ) {
      allowNextTabToLeaveRef.current = false;
      return;
    }

    if (allowNextTabToLeaveRef.current) {
      allowNextTabToLeaveRef.current = false;
      return;
    }

    event.preventDefault();

    const before = editorValueRef.current;
    const indentationEdit = changeTextIndentation(
      before,
      readSelection(event.currentTarget),
      event.shiftKey,
    );

    if (indentationEdit.value.length > MAX_ROOM_CSS_LENGTH) return;

    compositionFinalValueRef.current = null;
    compositionResultRef.current = null;
    const mergedText = commitSplices(before, indentationEdit.splices);
    const mergedSelection = mapSelectionThroughTextChanges(
      indentationEdit.value,
      mergedText,
      indentationEdit.selection,
    );

    updateEditor(mergedText, mergedSelection);
  }

  function handleCompositionStart() {
    isComposingRef.current = true;
    compositionBaseRef.current = editorValueRef.current;
    compositionFinalValueRef.current = null;
    compositionResultRef.current = null;
  }

  function handleEditorBlur() {
    allowNextTabToLeaveRef.current = false;
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLTextAreaElement>) {
    const composedValue = event.currentTarget.value;
    const composedSelection = readSelection(event.currentTarget);
    isComposingRef.current = false;

    const mergedText = commitEdit(compositionBaseRef.current, composedValue);
    const mergedSelection = mapSelectionThroughTextChanges(
      composedValue,
      mergedText,
      composedSelection,
    );

    compositionFinalValueRef.current = composedValue;
    compositionResultRef.current = mergedText;
    updateEditor(mergedText, mergedSelection);
  }

  function rememberSelection(event: SyntheticEvent<HTMLTextAreaElement>) {
    selectionRef.current = readSelection(event.currentTarget);
  }

  function resetRoomStyle() {
    if (isLoading || !hasSharedDocument) return;

    setSharedDocument((draft) => {
      if (!Array.isArray(draft.chars)) return;

      draft.chars.splice(
        0,
        draft.chars.length,
        ...ROOM_STYLE_SCAFFOLD.split(""),
      );
      draft.updatedAt = Date.now();
      draft.updatedBy = name;
      draft.version = 2;
    });

    updateEditor(ROOM_STYLE_SCAFFOLD, {
      start: 0,
      end: 0,
      direction: "none",
    });
  }

  const lastChangedBy = hasSharedDocument
    ? sharedDocument.updatedBy
    : legacyStyle.updatedBy;

  return (
    <>
      <style data-telepathy-room-style>{sharedCss}</style>
      <fieldset
        className="style-panel sidebar-panel"
        data-room-part="style"
        hidden={!active}
      >
        <legend>style</legend>
        <textarea
          aria-describedby={editorInstructionsId}
          aria-label="room css"
          className="style-editor"
          disabled={isLoading || !hasSharedDocument}
          maxLength={MAX_ROOM_CSS_LENGTH}
          onBlur={handleEditorBlur}
          onChange={handleEditorChange}
          onCompositionEnd={handleCompositionEnd}
          onCompositionStart={handleCompositionStart}
          onKeyDown={handleEditorKeyDown}
          onSelect={rememberSelection}
          ref={textareaRef}
          spellCheck={false}
          value={editorValue}
        />
        <span className="visually-hidden" id={editorInstructionsId}>
          Tab indents; Shift+Tab outdents. Press Escape, then Tab to leave the
          editor.
        </span>
        <div className="style-panel-footer">
          <output>
            {editorValue.length.toLocaleString()} /{" "}
            {MAX_ROOM_CSS_LENGTH.toLocaleString()}
          </output>
          <button
            disabled={isLoading || !hasSharedDocument}
            onClick={resetRoomStyle}
            type="button"
          >
            reset room style
          </button>
        </div>
        {lastChangedBy ? <small>last changed by {lastChangedBy}</small> : null}
      </fieldset>
    </>
  );
}

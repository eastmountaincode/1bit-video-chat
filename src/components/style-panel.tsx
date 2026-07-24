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
  computeTextSplice,
  type TextSelection,
  type TextSplice,
} from "@/lib/collaborative-text";
import {
  DEFAULT_COLLABORATIVE_ROOM_STYLE,
  DEFAULT_ROOM_STYLE,
  createRoomStyleDocument,
  ensureRoomStyleScaffold,
  getCollaborativeRoomStyleCss,
  MAX_ROOM_CSS_LENGTH,
  readLegacyRoomStyleCss,
  ROOM_STYLE_SCAFFOLD,
  syncLegacyRoomStyleCharacters,
  type CollaborativeRoomStyleData,
  type RoomStyleData,
} from "@/lib/room-style";
import {
  mapSelectionByIdentity,
  mergeTextEntrySplices,
  readTextEntries,
  readTextEntriesSafely,
  type SharedTextMerge,
} from "@/lib/shared-text-entries";
import {
  changeTextIndentation,
  insertLineBreakWithIndentation,
  type TextIndentationEdit,
} from "@/lib/text-indentation";

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
  const { cursors, isLoading } = usePlayContext();
  const [reconciliationFraction] = useState(Math.random);
  const participantCount = Math.max(1, cursors.allColors.length);
  // Let one client repair first instead of making every participant publish
  // the same full document epoch at once.
  const reconciliationDelayMs =
    25 +
    Math.floor(
      reconciliationFraction *
        Math.min(2_500, 100 + participantCount * 120),
    );
  const legacyCss = ensureRoomStyleScaffold(
    typeof legacyStyle.css === "string" ? legacyStyle.css : ROOM_STYLE_SCAFFOLD,
  );
  const sharedEntries = Array.isArray(sharedDocument.current?.entries)
    ? sharedDocument.current.entries
    : null;
  const legacyCharacters = Array.isArray(sharedDocument.chars)
    ? sharedDocument.chars
    : null;
  const legacyMirrorCss =
    legacyCharacters === null
      ? null
      : readLegacyRoomStyleCss(
          legacyCharacters,
          MAX_ROOM_CSS_LENGTH,
        );
  const decodedSharedCss =
    sharedEntries === null
      ? null
      : readTextEntriesSafely(
          sharedEntries,
          MAX_ROOM_CSS_LENGTH,
        );
  const sharedCss =
    sharedEntries === null
      ? getCollaborativeRoomStyleCss(sharedDocument, legacyCss)
      : (decodedSharedCss ?? legacyCss);
  const hasCurrentDocument = sharedEntries !== null;
  const rawCurrentDocumentId = sharedDocument.current?.id;
  const currentDocumentId =
    typeof rawCurrentDocumentId === "string" &&
    rawCurrentDocumentId.length > 0
      ? rawCurrentDocumentId
      : null;
  const currentDocumentIsMalformed =
    hasCurrentDocument &&
    (decodedSharedCss === null || currentDocumentId === null);
  const currentDocumentExceedsLimit =
    (sharedEntries?.length ?? 0) > MAX_ROOM_CSS_LENGTH;
  const legacyMirrorIsMalformed =
    legacyCharacters !== null && legacyMirrorCss === null;
  const legacyMirrorExceedsLimit =
    (legacyCharacters?.length ?? 0) > MAX_ROOM_CSS_LENGTH;
  const legacyMirrorIsOutOfSync =
    hasCurrentDocument &&
    decodedSharedCss !== null &&
    legacyMirrorCss !== decodedSharedCss;
  const compatibilityBridgeIsReady =
    sharedDocument.version === 3 &&
    legacyCharacters !== null &&
    !legacyMirrorIsMalformed &&
    !legacyMirrorExceedsLimit &&
    !legacyMirrorIsOutOfSync;
  const currentDocumentIsEditable =
    hasCurrentDocument &&
    !currentDocumentIsMalformed &&
    !currentDocumentExceedsLimit &&
    compatibilityBridgeIsReady;
  const reconciliationNeeded =
    hasCurrentDocument &&
    (sharedDocument.version !== 3 ||
      currentDocumentIsMalformed ||
      currentDocumentExceedsLimit ||
      legacyCharacters === null ||
      legacyMirrorIsMalformed ||
      legacyMirrorExceedsLimit ||
      legacyMirrorIsOutOfSync);
  const editorSharedEntries = currentDocumentIsEditable
    ? sharedEntries
    : null;
  const [editorValue, setEditorValue] = useState(ROOM_STYLE_SCAFFOLD);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorValueRef = useRef(ROOM_STYLE_SCAFFOLD);
  const editorEntriesRef = useRef<string[]>([]);
  const documentIdRef = useRef<string | null>(null);
  const entryCounterRef = useRef(0);
  const selectionRef = useRef<TextSelection>({
    start: 0,
    end: 0,
    direction: "none",
  });
  const pendingSelectionRef = useRef<TextSelection | null>(null);
  const isComposingRef = useRef(false);
  const compositionBaseRef = useRef(ROOM_STYLE_SCAFFOLD);
  const compositionFinalValueRef = useRef<string | null>(null);
  const allowNextTabToLeaveRef = useRef(false);

  function updateEditor(
    value: string,
    entries: string[],
    selection: TextSelection,
  ) {
    const valueChanged = editorValueRef.current !== value;
    const nextSelection = clampSelection(selection, value.length);
    editorValueRef.current = value;
    editorEntriesRef.current = entries;
    selectionRef.current = nextSelection;
    pendingSelectionRef.current = nextSelection;
    setEditorValue(value);
    if (!valueChanged) {
      setSelectionRevision((revision) => revision + 1);
    }
  }

  function createEntryPrefix() {
    entryCounterRef.current += 1;
    return `i${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}-${entryCounterRef.current.toString(36)}`;
  }

  useEffect(() => {
    if (isLoading || hasCurrentDocument) return;

    const timeoutId = window.setTimeout(() => {
      const legacyChannel = playhtml.createPageData<RoomStyleData>(
        "room-style:v1",
        DEFAULT_ROOM_STYLE,
      );
      const liveLegacyStyle = legacyChannel.getData();
      legacyChannel.destroy();

      setSharedDocument((draft) => {
        if (Array.isArray(draft.current?.entries)) return;

        const legacyDraftCss = Array.isArray(draft.chars)
          ? readLegacyRoomStyleCss(
              draft.chars,
              MAX_ROOM_CSS_LENGTH,
            )
          : null;
        const sourceCss = ensureRoomStyleScaffold(
          legacyDraftCss !== null
            ? legacyDraftCss
            : typeof liveLegacyStyle.css === "string"
              ? liveLegacyStyle.css
              : ROOM_STYLE_SCAFFOLD,
        );
        draft.current = createRoomStyleDocument(
          sourceCss,
          crypto.randomUUID(),
          Date.now(),
        );
        syncLegacyRoomStyleCharacters(draft, sourceCss);
        draft.updatedAt = Date.now();
        draft.updatedBy = name;
        draft.version = 3;
      });
    }, reconciliationDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    hasCurrentDocument,
    isLoading,
    name,
    reconciliationDelayMs,
    setSharedDocument,
  ]);

  useEffect(() => {
    if (isLoading || !reconciliationNeeded) return;

    const timeoutId = window.setTimeout(() => {
      setSharedDocument((draft) => {
        const liveEntries = draft.current?.entries;
        if (!Array.isArray(liveEntries)) return;

        const liveCss = readTextEntriesSafely(
          liveEntries,
          MAX_ROOM_CSS_LENGTH,
        );
        const liveDocumentId = draft.current?.id;
        const liveNeedsNewEpoch =
          liveCss === null ||
          liveEntries.length > MAX_ROOM_CSS_LENGTH ||
          typeof liveDocumentId !== "string" ||
          liveDocumentId.length === 0;
        const liveLegacyCharacters = Array.isArray(draft.chars)
          ? draft.chars
          : null;
        const liveLegacyCss =
          liveLegacyCharacters === null
            ? null
            : readLegacyRoomStyleCss(
                liveLegacyCharacters,
                MAX_ROOM_CSS_LENGTH,
              );
        let nextCss =
          liveCss ?? liveLegacyCss ?? ROOM_STYLE_SCAFFOLD;
        let currentChanged = false;

        if (liveNeedsNewEpoch) {
          draft.current = createRoomStyleDocument(
            nextCss,
            crypto.randomUUID(),
            Date.now(),
          );
          currentChanged = true;
        } else if (
          liveLegacyCss !== null &&
          (liveLegacyCss !== liveCss ||
            (liveLegacyCharacters?.length ?? 0) >
              MAX_ROOM_CSS_LENGTH)
        ) {
          nextCss = liveLegacyCss;
          draft.current = createRoomStyleDocument(
            nextCss,
            crypto.randomUUID(),
            Date.now(),
          );
          currentChanged = true;
        }

        const mirrorChanged = syncLegacyRoomStyleCharacters(
          draft,
          nextCss,
        );
        const versionChanged = draft.version !== 3;
        if (currentChanged || mirrorChanged || versionChanged) {
          draft.updatedAt = Date.now();
          draft.updatedBy = name;
          draft.version = 3;
        }
      });
    }, reconciliationDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    isLoading,
    name,
    reconciliationDelayMs,
    reconciliationNeeded,
    setSharedDocument,
  ]);

  useLayoutEffect(() => {
    if (!editorSharedEntries || isComposingRef.current) return;

    const previousEntries = editorEntriesRef.current;
    const nextDocumentId = currentDocumentId;
    const textarea = textareaRef.current;
    const currentSelection =
      textarea && document.activeElement === textarea
        ? readSelection(textarea)
        : selectionRef.current;
    const nextSelection =
      documentIdRef.current === nextDocumentId &&
      previousEntries.length > 0
        ? mapSelectionByIdentity(
            previousEntries,
            editorSharedEntries,
            currentSelection,
          )
        : clampSelection(currentSelection, editorSharedEntries.length);

    documentIdRef.current = nextDocumentId;
    updateEditor(
      sharedCss,
      [...editorSharedEntries],
      nextSelection,
    );
  }, [currentDocumentId, editorSharedEntries, sharedCss]);

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
  }, [editorValue, selectionRevision]);

  function commitSplices(
    before: string,
    localSplices: TextSplice[],
    selection: TextSelection,
  ) {
    let result: SharedTextMerge = {
      accepted: false,
      entries: editorEntriesRef.current,
      operations: [],
      selection: clampSelection(selection, before.length),
      text: before,
    };
    if (isLoading || !currentDocumentIsEditable) return result;

    setSharedDocument((draft) => {
      const liveDocument = draft.current;
      if (
        !liveDocument ||
        !Array.isArray(liveDocument.entries)
      ) {
        return;
      }
      const liveCss = readTextEntriesSafely(
        liveDocument.entries,
        MAX_ROOM_CSS_LENGTH,
      );
      if (
        liveCss === null ||
        liveDocument.entries.length > MAX_ROOM_CSS_LENGTH
      ) {
        return;
      }
      const liveDocumentId =
        typeof liveDocument.id === "string" &&
        liveDocument.id.length > 0
          ? liveDocument.id
          : null;
      const liveLegacyCharacters = Array.isArray(draft.chars)
        ? draft.chars
        : null;
      const liveLegacyCss =
        liveLegacyCharacters === null
          ? null
          : readLegacyRoomStyleCss(
              liveLegacyCharacters,
              MAX_ROOM_CSS_LENGTH,
            );
      const liveBridgeIsReady =
        draft.version === 3 &&
        liveDocumentId !== null &&
        liveLegacyCharacters !== null &&
        liveLegacyCharacters.length <= MAX_ROOM_CSS_LENGTH &&
        liveLegacyCss === liveCss;

      if (
        !liveBridgeIsReady ||
        liveDocumentId !== documentIdRef.current
      ) {
        const documentEpochMatches =
          liveDocumentId === documentIdRef.current;
        documentIdRef.current = liveDocumentId;
        result = {
          accepted: false,
          entries: [...liveDocument.entries],
          operations: [],
          selection: documentEpochMatches
            ? mapSelectionByIdentity(
                editorEntriesRef.current,
                liveDocument.entries,
                selection,
              )
            : clampSelection(selection, liveCss.length),
          text: liveCss,
        };
        return;
      }

      result = mergeTextEntrySplices(
        editorEntriesRef.current,
        liveDocument.entries,
        localSplices,
        selection,
        createEntryPrefix,
        MAX_ROOM_CSS_LENGTH,
      );

      for (const operation of result.operations) {
        liveDocument.entries.splice(
          operation.index,
          operation.deleteCount,
          ...operation.insert,
        );
        liveLegacyCharacters.splice(
          operation.index,
          operation.deleteCount,
          ...readTextEntries(operation.insert).split(""),
        );
      }

      if (result.operations.length > 0) {
        draft.updatedAt = Date.now();
        draft.updatedBy = name;
        draft.version = 3;
      }
    });

    return result;
  }

  function commitEdit(
    before: string,
    after: string,
    selection: TextSelection,
  ) {
    const localSplice = computeTextSplice(before, after);
    if (!localSplice) {
      return commitSplices(before, [], selection);
    }
    return commitSplices(before, [localSplice], selection);
  }

  function applyKeyboardEdit(before: string, edit: TextIndentationEdit) {
    if (edit.value.length > MAX_ROOM_CSS_LENGTH) return;

    compositionFinalValueRef.current = null;
    const result = commitSplices(before, edit.splices, edit.selection);
    updateEditor(result.text, result.entries, result.selection);
  }

  function handleEditorChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextValue = event.currentTarget.value;
    const nextSelection = readSelection(event.currentTarget);

    if (
      !isComposingRef.current &&
      compositionFinalValueRef.current === nextValue
    ) {
      compositionFinalValueRef.current = null;
      updateEditor(
        editorValueRef.current,
        editorEntriesRef.current,
        selectionRef.current,
      );
      return;
    }

    compositionFinalValueRef.current = null;

    if (isComposingRef.current) {
      editorValueRef.current = nextValue;
      selectionRef.current = nextSelection;
      setEditorValue(nextValue);
      return;
    }

    const result = commitEdit(
      editorValueRef.current,
      nextValue,
      nextSelection,
    );
    updateEditor(result.text, result.entries, result.selection);
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      allowNextTabToLeaveRef.current = true;
      return;
    }

    if (event.key === "Enter") {
      allowNextTabToLeaveRef.current = false;
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.nativeEvent.isComposing ||
        isComposingRef.current
      ) {
        return;
      }

      const before = editorValueRef.current;
      const edit = insertLineBreakWithIndentation(
        before,
        readSelection(event.currentTarget),
        MAX_ROOM_CSS_LENGTH,
      );
      if (edit.value.length > MAX_ROOM_CSS_LENGTH) return;

      event.preventDefault();
      applyKeyboardEdit(before, edit);
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
    applyKeyboardEdit(
      before,
      changeTextIndentation(
        before,
        readSelection(event.currentTarget),
        event.shiftKey,
      ),
    );
  }

  function handleCompositionStart() {
    isComposingRef.current = true;
    compositionBaseRef.current = editorValueRef.current;
    compositionFinalValueRef.current = null;
  }

  function handleEditorBlur() {
    allowNextTabToLeaveRef.current = false;
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLTextAreaElement>) {
    const composedValue = event.currentTarget.value;
    const composedSelection = readSelection(event.currentTarget);
    isComposingRef.current = false;

    const result = commitEdit(
      compositionBaseRef.current,
      composedValue,
      composedSelection,
    );
    compositionFinalValueRef.current = composedValue;
    updateEditor(result.text, result.entries, result.selection);
  }

  function rememberSelection(event: SyntheticEvent<HTMLTextAreaElement>) {
    selectionRef.current = readSelection(event.currentTarget);
  }

  function resetRoomStyle() {
    if (isLoading || !hasCurrentDocument) return;

    setSharedDocument((draft) => {
      if (!Array.isArray(draft.current?.entries)) return;

      draft.current = createRoomStyleDocument(
        ROOM_STYLE_SCAFFOLD,
        crypto.randomUUID(),
        Date.now(),
      );
      syncLegacyRoomStyleCharacters(draft, ROOM_STYLE_SCAFFOLD);
      draft.updatedAt = Date.now();
      draft.updatedBy = name;
      draft.version = 3;
    });
  }

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
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className="style-editor"
          disabled={isLoading || !currentDocumentIsEditable}
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
          Enter keeps the current indentation and adds one level after an
          opening brace. Tab indents; Shift+Tab outdents. Press Escape, then
          Tab to leave the editor.
        </span>
        <div className="style-panel-footer">
          <output>
            {editorValue.length.toLocaleString()} /{" "}
            {MAX_ROOM_CSS_LENGTH.toLocaleString()}
          </output>
          <button
            disabled={isLoading || !hasCurrentDocument}
            onClick={resetRoomStyle}
            type="button"
          >
            reset room style
          </button>
        </div>
      </fieldset>
    </>
  );
}

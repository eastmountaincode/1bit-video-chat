"use client";

import { usePageData, usePlayContext } from "@playhtml/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react";

import {
  createCollaborativeCodeDocument,
  type CollaborativeCodeData,
} from "@/lib/collaborative-code";
import {
  computeTextSplice,
  type TextSelection,
  type TextSplice,
} from "@/lib/collaborative-text";
import { resolveEditorSelection } from "@/lib/editor-selection";
import {
  mapSelectionByIdentity,
  mergeTextEntrySplices,
  readTextEntriesSafely,
  type SharedTextMerge,
} from "@/lib/shared-text-entries";
import {
  changeTextIndentation,
  insertLineBreakWithIndentation,
  type TextIndentationEdit,
} from "@/lib/text-indentation";

interface CollaborativeCodeEditorOptions {
  channelName: string;
  defaultData: CollaborativeCodeData;
  disabled: boolean;
  entryPrefix: string;
  initialCode: string;
  maxLength: number;
  name: string;
  onRunShortcut?: (code: string) => void;
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

export function useCollaborativeCodeEditor({
  channelName,
  defaultData,
  disabled,
  entryPrefix,
  initialCode,
  maxLength,
  name,
  onRunShortcut,
}: CollaborativeCodeEditorOptions) {
  const [sharedDocument, setSharedDocument] =
    usePageData<CollaborativeCodeData>(channelName, defaultData);
  const { cursors, isLoading } = usePlayContext();
  const [reconciliationFraction] = useState(Math.random);
  const participantCount = Math.max(1, cursors.allColors.length);
  const reconciliationDelayMs =
    25 +
    Math.floor(
      reconciliationFraction *
        Math.min(2_500, 100 + participantCount * 120),
    );
  const sharedEntries = Array.isArray(sharedDocument.current?.entries)
    ? sharedDocument.current.entries
    : null;
  const sharedCode =
    sharedEntries === null
      ? null
      : readTextEntriesSafely(sharedEntries, maxLength);
  const hasCurrentDocument = sharedEntries !== null;
  const rawCurrentDocumentId = sharedDocument.current?.id;
  const currentDocumentId =
    typeof rawCurrentDocumentId === "string" &&
    rawCurrentDocumentId.length > 0
      ? rawCurrentDocumentId
      : null;
  const currentDocumentIsMalformed =
    hasCurrentDocument &&
    (sharedCode === null || currentDocumentId === null);
  const currentDocumentExceedsLimit =
    (sharedEntries?.length ?? 0) > maxLength;
  const currentDocumentIsEditable =
    hasCurrentDocument &&
    !currentDocumentIsMalformed &&
    !currentDocumentExceedsLimit &&
    sharedDocument.version === 1;
  const reconciliationNeeded =
    hasCurrentDocument && !currentDocumentIsEditable;
  const editorSharedEntries = currentDocumentIsEditable
    ? sharedEntries
    : null;
  const controlsDisabled = disabled || isLoading;
  const [editorValue, setEditorValue] = useState(initialCode);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editorValueRef = useRef(initialCode);
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
  const compositionBaseRef = useRef(initialCode);
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
    return `${entryPrefix}${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}-${entryCounterRef.current.toString(36)}`;
  }

  useEffect(() => {
    if (controlsDisabled || hasCurrentDocument) return;

    const timeoutId = window.setTimeout(() => {
      setSharedDocument((draft) => {
        if (Array.isArray(draft.current?.entries)) return;

        draft.current = createCollaborativeCodeDocument(
          initialCode,
          crypto.randomUUID(),
          Date.now(),
          maxLength,
        );
        draft.updatedAt = Date.now();
        draft.updatedBy = name;
        draft.version = 1;
      });
    }, reconciliationDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    controlsDisabled,
    hasCurrentDocument,
    initialCode,
    maxLength,
    name,
    reconciliationDelayMs,
    setSharedDocument,
  ]);

  useEffect(() => {
    if (controlsDisabled || !reconciliationNeeded) return;

    const timeoutId = window.setTimeout(() => {
      setSharedDocument((draft) => {
        const liveEntries = draft.current?.entries;
        if (!Array.isArray(liveEntries)) return;

        const liveCode = readTextEntriesSafely(liveEntries, maxLength);
        const liveDocumentId = draft.current?.id;
        const liveDocumentIsValid =
          liveCode !== null &&
          liveEntries.length <= maxLength &&
          typeof liveDocumentId === "string" &&
          liveDocumentId.length > 0 &&
          draft.version === 1;

        if (liveDocumentIsValid) return;

        draft.current = createCollaborativeCodeDocument(
          liveCode ?? initialCode,
          crypto.randomUUID(),
          Date.now(),
          maxLength,
        );
        draft.updatedAt = Date.now();
        draft.updatedBy = name;
        draft.version = 1;
      });
    }, reconciliationDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    controlsDisabled,
    initialCode,
    maxLength,
    name,
    reconciliationDelayMs,
    reconciliationNeeded,
    setSharedDocument,
  ]);

  useLayoutEffect(() => {
    if (!editorSharedEntries || sharedCode === null || isComposingRef.current) {
      return;
    }

    const previousEntries = editorEntriesRef.current;
    const textarea = textareaRef.current;
    const focusedSelection =
      textarea && document.activeElement === textarea
        ? readSelection(textarea)
        : null;
    const currentSelection = resolveEditorSelection(
      pendingSelectionRef.current,
      focusedSelection,
      selectionRef.current,
    );
    const nextSelection =
      documentIdRef.current === currentDocumentId &&
      previousEntries.length > 0
        ? mapSelectionByIdentity(
            previousEntries,
            editorSharedEntries,
            currentSelection,
          )
        : clampSelection(currentSelection, editorSharedEntries.length);

    documentIdRef.current = currentDocumentId;
    updateEditor(
      sharedCode,
      [...editorSharedEntries],
      nextSelection,
    );
  }, [
    currentDocumentId,
    editorSharedEntries,
    sharedCode,
  ]);

  useLayoutEffect(() => {
    const pendingSelection = pendingSelectionRef.current;
    const textarea = textareaRef.current;
    pendingSelectionRef.current = null;

    if (!pendingSelection || !textarea) return;

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
    if (controlsDisabled || !currentDocumentIsEditable) return result;

    setSharedDocument((draft) => {
      const liveDocument = draft.current;
      if (!liveDocument || !Array.isArray(liveDocument.entries)) return;

      const liveCode = readTextEntriesSafely(
        liveDocument.entries,
        maxLength,
      );
      const liveDocumentId =
        typeof liveDocument.id === "string" &&
        liveDocument.id.length > 0
          ? liveDocument.id
          : null;
      const liveDocumentIsEditable =
        liveCode !== null &&
        liveDocument.entries.length <= maxLength &&
        liveDocumentId !== null &&
        draft.version === 1;

      if (
        !liveDocumentIsEditable ||
        liveDocumentId !== documentIdRef.current
      ) {
        const documentEpochMatches =
          liveDocumentId === documentIdRef.current;
        documentIdRef.current = liveDocumentId;
        result = {
          accepted: false,
          entries: [...liveDocument.entries],
          operations: [],
          selection:
            documentEpochMatches && liveDocumentIsEditable
              ? mapSelectionByIdentity(
                  editorEntriesRef.current,
                  liveDocument.entries,
                  selection,
                )
              : clampSelection(selection, liveCode?.length ?? 0),
          text: liveCode ?? before,
        };
        return;
      }

      result = mergeTextEntrySplices(
        editorEntriesRef.current,
        liveDocument.entries,
        localSplices,
        selection,
        createEntryPrefix,
        maxLength,
      );

      for (const operation of result.operations) {
        liveDocument.entries.splice(
          operation.index,
          operation.deleteCount,
          ...operation.insert,
        );
      }

      if (result.operations.length > 0) {
        draft.updatedAt = Date.now();
        draft.updatedBy = name;
        draft.version = 1;
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
    return commitSplices(
      before,
      localSplice ? [localSplice] : [],
      selection,
    );
  }

  function applyKeyboardEdit(before: string, edit: TextIndentationEdit) {
    if (edit.value.length > maxLength) return;

    compositionFinalValueRef.current = null;
    const result = commitSplices(before, edit.splices, edit.selection);
    updateEditor(result.text, result.entries, result.selection);
  }

  function runCurrentCode() {
    const code = editorValueRef.current;
    if (
      controlsDisabled ||
      !currentDocumentIsEditable ||
      code.trim().length === 0
    ) {
      return;
    }
    onRunShortcut?.(code);
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>) {
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

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      onRunShortcut &&
      event.key === "Enter" &&
      (event.ctrlKey || event.metaKey) &&
      !event.nativeEvent.isComposing &&
      !isComposingRef.current
    ) {
      event.preventDefault();
      runCurrentCode();
      return;
    }

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
        maxLength,
      );
      if (edit.value.length > maxLength) return;

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

  function handleBlur() {
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

  function handleSelect(event: SyntheticEvent<HTMLTextAreaElement>) {
    selectionRef.current = readSelection(event.currentTarget);
  }

  return {
    controlsDisabled,
    editorDisabled: controlsDisabled || !currentDocumentIsEditable,
    editorValue,
    handleBlur,
    handleChange,
    handleCompositionEnd,
    handleCompositionStart,
    handleKeyDown,
    handleSelect,
    runCurrentCode,
    runDisabled:
      controlsDisabled ||
      !currentDocumentIsEditable ||
      editorValue.trim().length === 0,
    textareaRef,
  };
}

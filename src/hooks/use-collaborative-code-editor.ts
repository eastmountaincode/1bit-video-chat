"use client";

import { usePageData, usePlayContext } from "@playhtml/react";
import {
  useEffect,
  useLayoutEffect,
    useMemo,
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
    type CollaborativeCodeDocument,
} from "@/lib/collaborative-code";
import { getCodeEditorShortcut } from "@/lib/code-editor-shortcut";
import {
  computeTextSplice,
  type TextSelection,
  type TextSplice,
} from "@/lib/collaborative-text";
import { resolveEditorSelection } from "@/lib/editor-selection";
import { revealTextareaCaret } from "@/lib/textarea-caret";
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

export interface CodeDocumentAdapter {
    initialize: (document: CollaborativeCodeDocument) => void;
    ready: (document: CollaborativeCodeDocument) => boolean;
    project: (document: CollaborativeCodeDocument) => string[];
    merge: (document: CollaborativeCodeDocument, base: string[], splices: TextSplice[], selection: TextSelection, prefix: () => string, maxLength: number) => SharedTextMerge;
}

interface CollaborativeCodeEditorOptions {
    documentAdapter?: CodeDocumentAdapter;
    maxStoredLength?: number;
  channelName: string;
  defaultData: CollaborativeCodeData;
  disabled: boolean;
  entryPrefix: string;
  initialCode: string;
  maxLength: number;
  name: string;
  onRunShortcut?: (code: string) => void;
  onStopShortcut?: () => void;
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
    documentAdapter,
  disabled,
  entryPrefix,
  initialCode,
  maxLength,
    maxStoredLength = maxLength,
  name,
  onRunShortcut,
  onStopShortcut,
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
      : readTextEntriesSafely(sharedEntries, maxStoredLength);
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
    (sharedEntries?.length ?? 0) > maxStoredLength;
  const currentDocumentIsEditable =
    hasCurrentDocument &&
    !currentDocumentIsMalformed &&
    !currentDocumentExceedsLimit &&
    sharedDocument.version === 1;
  const reconciliationNeeded =
    hasCurrentDocument && !currentDocumentIsEditable;
    const codeDocument = sharedDocument.current;
    const adapterReady = !documentAdapter || (codeDocument !== null && documentAdapter.ready(codeDocument));
    const editorSharedEntries = useMemo(() => {
        if (!currentDocumentIsEditable || !codeDocument) return null;
        return documentAdapter ? documentAdapter.project(codeDocument) : codeDocument.entries;
    }, [currentDocumentIsEditable, codeDocument, documentAdapter]);
    const visibleCode = editorSharedEntries ? readTextEntriesSafely(editorSharedEntries, maxStoredLength) : null;
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
    const pendingCaretRevealRef = useRef(false);
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
          maxStoredLength,
        );
        documentAdapter?.initialize(draft.current);
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
    maxStoredLength,
    documentAdapter,
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

        const liveCode = readTextEntriesSafely(liveEntries, maxStoredLength);
        const liveDocumentId = draft.current?.id;
        const liveDocumentIsValid =
          liveCode !== null &&
          liveEntries.length <= maxStoredLength &&
          typeof liveDocumentId === "string" &&
          liveDocumentId.length > 0 &&
          draft.version === 1;

        if (liveDocumentIsValid) return;

        draft.current = createCollaborativeCodeDocument(
          liveCode ?? initialCode,
          crypto.randomUUID(),
          Date.now(),
          maxStoredLength,
        );
        documentAdapter?.initialize(draft.current);
        draft.updatedAt = Date.now();
        draft.updatedBy = name;
        draft.version = 1;
      });
    }, reconciliationDelayMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    controlsDisabled,
    initialCode,
    maxStoredLength,
    documentAdapter,
    name,
    reconciliationDelayMs,
    reconciliationNeeded,
    setSharedDocument,
  ]);

    useEffect(() => {
        if (controlsDisabled || !currentDocumentIsEditable || adapterReady || !documentAdapter) return;
        setSharedDocument((draft) => {
            if (draft.current) documentAdapter.initialize(draft.current);
        });
    }, [controlsDisabled, currentDocumentIsEditable, adapterReady, currentDocumentId, documentAdapter, setSharedDocument]);

  useLayoutEffect(() => {
    if (!editorSharedEntries || visibleCode === null || isComposingRef.current) {
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
      visibleCode,
      [...editorSharedEntries],
      nextSelection,
    );
  }, [
    currentDocumentId,
    editorSharedEntries,
    visibleCode,
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
    if (pendingCaretRevealRef.current) {
        pendingCaretRevealRef.current = false;
        revealTextareaCaret(textarea);
    }
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
    if (controlsDisabled || !currentDocumentIsEditable || !adapterReady) return result;

    setSharedDocument((draft) => {
      const liveDocument = draft.current;
      if (!liveDocument || !Array.isArray(liveDocument.entries)) return;

      const liveCode = readTextEntriesSafely(
        liveDocument.entries,
        maxStoredLength,
      );
      const liveDocumentId =
        typeof liveDocument.id === "string" &&
        liveDocument.id.length > 0
          ? liveDocument.id
          : null;
      const liveDocumentIsEditable =
        liveCode !== null &&
        liveDocument.entries.length <= maxStoredLength &&
        liveDocumentId !== null &&
        draft.version === 1;
        const visibleEntries = documentAdapter ? documentAdapter.project(liveDocument) : liveDocument.entries;

      if (
        !liveDocumentIsEditable ||
        liveDocumentId !== documentIdRef.current
      ) {
        const documentEpochMatches =
          liveDocumentId === documentIdRef.current;
        documentIdRef.current = liveDocumentId;
        result = {
          accepted: false,
          entries: [...visibleEntries],
          operations: [],
          selection:
            documentEpochMatches && liveDocumentIsEditable
              ? mapSelectionByIdentity(
                  editorEntriesRef.current,
                  visibleEntries,
                  selection,
                )
              : clampSelection(selection, liveCode?.length ?? 0),
          text: readTextEntriesSafely(visibleEntries, maxStoredLength) ?? before,
        };
        return;
      }

      if (documentAdapter) {
          result = documentAdapter.merge(liveDocument, editorEntriesRef.current, localSplices, selection, createEntryPrefix, maxLength);
          if (result.operations.length > 0) {
              draft.updatedAt = Date.now();
              draft.updatedBy = name;
              draft.version = 1;
          }
          return;
      }

      result = mergeTextEntrySplices(
        editorEntriesRef.current,
        liveDocument.entries,
        localSplices,
        selection,
        createEntryPrefix,
        maxStoredLength,
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
    pendingCaretRevealRef.current = result.text !== edit.value;
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

    function replaceCode(code: string) {
        if (controlsDisabled || !currentDocumentIsEditable || isComposingRef.current || code.length > maxLength) return;
        const now = Date.now();
        const next = createCollaborativeCodeDocument(code, crypto.randomUUID(), now, maxStoredLength);
        documentAdapter?.initialize(next);
        setSharedDocument((draft) => {
            draft.current = next;
            draft.updatedAt = now;
            draft.updatedBy = name;
            draft.version = 1;
        });
        documentIdRef.current = next.id;
        compositionFinalValueRef.current = null;
        pendingCaretRevealRef.current = false;
        const entries = documentAdapter ? documentAdapter.project(next) : next.entries;
        updateEditor(readTextEntriesSafely(entries, maxLength) ?? code, entries, { start: 0, end: 0, direction: "none" });
        if (textareaRef.current) textareaRef.current.scrollTop = 0;
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
    pendingCaretRevealRef.current = result.text !== nextValue;
    updateEditor(result.text, result.entries, result.selection);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const shortcut = getCodeEditorShortcut({
      altKey: event.altKey,
      code: event.code,
      ctrlKey: event.ctrlKey,
      isComposing:
        event.nativeEvent.isComposing || isComposingRef.current,
      key: event.key,
      metaKey: event.metaKey,
    });

    if (shortcut === "run" && onRunShortcut) {
      event.preventDefault();
      runCurrentCode();
      return;
    }
    if (shortcut === "stop" && onStopShortcut) {
      event.preventDefault();
      onStopShortcut();
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
    pendingCaretRevealRef.current = result.text !== composedValue;
    updateEditor(result.text, result.entries, result.selection);
  }

  function handleSelect(event: SyntheticEvent<HTMLTextAreaElement>) {
    selectionRef.current = readSelection(event.currentTarget);
  }

  return {
    controlsDisabled,
    sharedDocument,
    editorDisabled: controlsDisabled || !currentDocumentIsEditable || !adapterReady,
    editorValue,
    handleBlur,
    handleChange,
    handleCompositionEnd,
    handleCompositionStart,
    handleKeyDown,
    handleSelect,
    runCurrentCode,
    replaceCode,
    runDisabled:
      controlsDisabled ||
      !currentDocumentIsEditable ||
      editorValue.trim().length === 0,
    textareaRef,
  };
}

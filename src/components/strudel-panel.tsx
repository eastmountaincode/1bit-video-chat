"use client";

import { usePageData, usePlayContext } from "@playhtml/react";
import { useCallback, useId } from "react";

import { StrudelRuntimeControls } from "@/components/strudel-runtime-controls";
import { useCollaborativeCodeEditor } from "@/hooks/use-collaborative-code-editor";
import {
  createRoomStrudelRuntimeSnapshot,
  DEFAULT_COLLABORATIVE_ROOM_STRUDEL,
  DEFAULT_ROOM_STRUDEL_RUNTIME,
  DEFAULT_STRUDEL_CODE,
  MAX_STRUDEL_CODE_LENGTH,
  normalizeRoomStrudelRuntimeData,
  type RoomStrudelRuntimeData,
} from "@/lib/room-strudel";

interface StrudelPanelProps {
  active: boolean;
  disabled: boolean;
  name: string;
}

export function StrudelPanel({
  active,
  disabled,
  name,
}: StrudelPanelProps) {
  const editorInstructionsId = useId();
  const { isLoading } = usePlayContext();
  const [rawRoomRuntime, setRoomRuntime] =
    usePageData<RoomStrudelRuntimeData>(
      "room-strudel-runtime:v1",
      DEFAULT_ROOM_STRUDEL_RUNTIME,
    );
  const roomRuntime =
    normalizeRoomStrudelRuntimeData(rawRoomRuntime).current;
  const runStrudel = useCallback(
    (code: string, commandId?: string) => {
      if (disabled || isLoading || !code.trim()) return;

      setRoomRuntime((draft) => {
        draft.current = createRoomStrudelRuntimeSnapshot({
          code,
          commandId: commandId ?? crypto.randomUUID(),
          enabled: true,
          requestedAt: Date.now(),
          requestedBy: name,
        });
        draft.version = 1;
      });
    },
    [disabled, isLoading, name, setRoomRuntime],
  );
  const stopStrudel = useCallback(
    (commandId?: string) => {
      if (disabled || isLoading) return;

      setRoomRuntime((draft) => {
        const current =
          normalizeRoomStrudelRuntimeData(draft).current;
        draft.current = createRoomStrudelRuntimeSnapshot({
          code: current?.code ?? DEFAULT_STRUDEL_CODE,
          commandId: commandId ?? crypto.randomUUID(),
          enabled: false,
          requestedAt: Date.now(),
          requestedBy: name,
        });
        draft.version = 1;
      });
    },
    [disabled, isLoading, name, setRoomRuntime],
  );
  const {
    controlsDisabled,
    editorDisabled,
    editorValue,
    handleBlur,
    handleChange,
    handleCompositionEnd,
    handleCompositionStart,
    handleKeyDown,
    handleSelect,
    runDisabled,
    textareaRef,
  } = useCollaborativeCodeEditor({
    channelName: "room-strudel-code:v1",
    defaultData: DEFAULT_COLLABORATIVE_ROOM_STRUDEL,
    disabled,
    entryPrefix: "s",
    initialCode: DEFAULT_STRUDEL_CODE,
    maxLength: MAX_STRUDEL_CODE_LENGTH,
    name,
    onRunShortcut: runStrudel,
    onStopShortcut: stopStrudel,
  });
  return (
    <fieldset
      className="strudel-panel sidebar-panel"
      data-room-part="strudel"
      hidden={!active}
    >
      <legend>strudel</legend>
      <textarea
        aria-describedby={editorInstructionsId}
        aria-keyshortcuts="Control+Enter Meta+Enter Control+. Meta+."
        aria-label="room strudel pattern"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        className="strudel-editor"
        disabled={editorDisabled}
        maxLength={MAX_STRUDEL_CODE_LENGTH}
        onBlur={handleBlur}
        onChange={handleChange}
        onCompositionEnd={handleCompositionEnd}
        onCompositionStart={handleCompositionStart}
        onKeyDown={handleKeyDown}
        onSelect={handleSelect}
        ref={textareaRef}
        spellCheck={false}
        value={editorValue}
      />
      <span className="visually-hidden" id={editorInstructionsId}>
        Edits, run, update, and stop are shared with the room. Control and
        Enter, or Command and Enter, updates the current pattern without
        resetting its cycle. Control and Period, or Command and Period,
        stops it. Enter keeps the current indentation. Tab indents;
        Shift+Tab outdents. Press Escape, then Tab to leave the editor.
      </span>
      <div className="strudel-panel-footer">
        <StrudelRuntimeControls
          canRun={!runDisabled}
          code={editorValue}
          disabled={controlsDisabled}
          onRun={runStrudel}
          onStop={stopStrudel}
          runtime={roomRuntime}
        />
      </div>
    </fieldset>
  );
}

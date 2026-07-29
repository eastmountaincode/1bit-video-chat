"use client";

import { useId, useRef } from "react";

import {
  StrudelRuntimeControls,
  type StrudelRuntimeControlsHandle,
} from "@/components/strudel-runtime-controls";
import { useCollaborativeCodeEditor } from "@/hooks/use-collaborative-code-editor";
import {
  DEFAULT_COLLABORATIVE_ROOM_STRUDEL,
  DEFAULT_STRUDEL_CODE,
  MAX_STRUDEL_CODE_LENGTH,
} from "@/lib/room-strudel";

interface StrudelPanelProps {
  active: boolean;
  disabled: boolean;
  name: string;
  runtimeEnabled: boolean;
}

export function StrudelPanel({
  active,
  disabled,
  name,
  runtimeEnabled,
}: StrudelPanelProps) {
  const editorInstructionsId = useId();
  const runtimeControlsRef =
    useRef<StrudelRuntimeControlsHandle>(null);
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
    onRunShortcut: (code) => runtimeControlsRef.current?.update(code),
    onStopShortcut: () => runtimeControlsRef.current?.stop(),
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
        Edits are shared with the room. Run and stop affect audio on this
        device. Control and Enter, or Command and Enter, updates the current
        pattern without resetting its cycle. Control and Period, or Command
        and Period, stops it. Enter keeps the current indentation. Tab
        indents; Shift+Tab outdents. Press Escape, then Tab to leave the
        editor.
      </span>
      <div className="strudel-panel-footer">
        {runtimeEnabled ? (
          <StrudelRuntimeControls
            canRun={!runDisabled}
            code={editorValue}
            controlRef={runtimeControlsRef}
            disabled={controlsDisabled}
          />
        ) : null}
      </div>
    </fieldset>
  );
}

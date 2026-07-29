"use client";

import { useId, useState } from "react";

import { StrudelRuntimeControls } from "@/components/strudel-runtime-controls";
import { useCollaborativeCodeEditor } from "@/hooks/use-collaborative-code-editor";
import {
  DEFAULT_COLLABORATIVE_ROOM_STRUDEL,
  DEFAULT_STRUDEL_CODE,
  MAX_STRUDEL_CODE_LENGTH,
  type StrudelRuntimeStatus,
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
  const [runtimeStatus, setRuntimeStatus] =
    useState<StrudelRuntimeStatus | null>(null);
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
  });
  const error =
    runtimeStatus?.state === "error" ? runtimeStatus.error : null;

  return (
    <fieldset
      className="strudel-panel sidebar-panel"
      data-room-part="strudel"
      hidden={!active}
    >
      <legend>strudel</legend>
      <textarea
        aria-describedby={editorInstructionsId}
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
        device. Enter keeps the current indentation. Tab indents; Shift+Tab
        outdents. Press Escape, then Tab to leave the editor.
      </span>
      {error ? (
        <p className="strudel-runtime-note error-note" role="alert">
          strudel error: {error}
        </p>
      ) : null}
      <div className="strudel-panel-footer">
        {runtimeEnabled ? (
          <StrudelRuntimeControls
            canRun={!runDisabled}
            code={editorValue}
            disabled={controlsDisabled}
            onStatusChange={setRuntimeStatus}
          />
        ) : null}
      </div>
    </fieldset>
  );
}

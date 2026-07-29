"use client";

import { useId } from "react";

import { useCollaborativeCodeEditor } from "@/hooks/use-collaborative-code-editor";
import {
  DEFAULT_COLLABORATIVE_ROOM_HYDRA,
  MAX_HYDRA_CODE_LENGTH,
  type HydraRuntimeStatus,
  type RoomHydraData,
} from "@/lib/room-hydra";

interface HydraPanelProps {
  active: boolean;
  disabled: boolean;
  hydra: RoomHydraData;
  name: string;
  onRun: (code: string) => void;
  onStop: () => void;
  runtimeStatus: HydraRuntimeStatus | null;
}

export function HydraPanel({
  active,
  disabled,
  hydra,
  name,
  onRun,
  onStop,
  runtimeStatus,
}: HydraPanelProps) {
  const editorInstructionsId = useId();
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
    runCurrentCode,
    runDisabled,
    textareaRef,
  } = useCollaborativeCodeEditor({
    channelName: "room-hydra-code:v1",
    defaultData: DEFAULT_COLLABORATIVE_ROOM_HYDRA,
    disabled,
    entryPrefix: "h",
    initialCode: hydra.code,
    maxLength: MAX_HYDRA_CODE_LENGTH,
    name,
    onRunShortcut: onRun,
  });
  const error =
    hydra.enabled && runtimeStatus?.state === "error"
      ? runtimeStatus.error
      : null;

  return (
    <fieldset
      className="hydra-panel sidebar-panel"
      data-room-part="hydra"
      hidden={!active}
    >
      <legend>hydra</legend>
      <textarea
        aria-describedby={editorInstructionsId}
        aria-label="room hydra sketch"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        className="hydra-editor"
        disabled={editorDisabled}
        maxLength={MAX_HYDRA_CODE_LENGTH}
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
        Edits are shared with the room. Control and Enter, or Command and
        Enter, runs the current sketch. Enter keeps the current indentation.
        Tab indents; Shift+Tab outdents. Press Escape, then Tab to leave the
        editor.
      </span>
      {error ? (
        <p className="hydra-runtime-note error-note" role="alert">
          hydra error: {error}
        </p>
      ) : null}
      <div className="hydra-panel-footer">
        {hydra.enabled ? (
          <button
            disabled={controlsDisabled}
            onClick={onStop}
            type="button"
          >
            stop hydra
          </button>
        ) : null}
        <button
          disabled={runDisabled}
          onClick={runCurrentCode}
          type="button"
        >
          run hydra
        </button>
      </div>
    </fieldset>
  );
}

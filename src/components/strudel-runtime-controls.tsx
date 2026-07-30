"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  createStrudelRevision,
  isStrudelFrameEvent,
  type RoomStrudelRuntimeSnapshot,
  type StrudelFrameCommand,
} from "@/lib/room-strudel";
import { STRUDEL_FRAME_DOCUMENT } from "@/lib/strudel-frame-document";

interface StrudelRuntimeControlsProps {
  canRun: boolean;
  code: string;
  disabled: boolean;
  onRun: (code: string, commandId?: string) => void;
  onStop: (commandId?: string) => void;
  runtime: RoomStrudelRuntimeSnapshot | null;
}

export function StrudelRuntimeControls({
  canRun,
  code,
  disabled,
  onRun,
  onStop,
  runtime,
}: StrudelRuntimeControlsProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const revision = useMemo(
    () => createStrudelRevision(code),
    [code],
  );
  const runtimeCode = runtime?.code ?? "";
  const runtimeCommandId = runtime?.commandId ?? "";
  const runtimeEnabled = runtime?.enabled ?? false;

  useEffect(() => {
    function handleFrameMessage(event: MessageEvent) {
      if (
        event.source !== frameRef.current?.contentWindow ||
        !isStrudelFrameEvent(event.data)
      ) {
        return;
      }

      if (event.data.type === "ready") {
        setReady(true);
      } else if (event.data.type === "run-request") {
        onRun(event.data.code, event.data.commandId);
      } else if (event.data.type === "stop-request") {
        onStop(event.data.commandId);
      }
    }

    window.addEventListener("message", handleFrameMessage);
    return () => window.removeEventListener("message", handleFrameMessage);
  }, [onRun, onStop]);

  useEffect(() => {
    if (!ready) return;

    const command: StrudelFrameCommand = {
      canRun,
      code,
      disabled,
      revision,
      source: "telepathy-strudel",
      type: "stage",
    };
    frameRef.current?.contentWindow?.postMessage(command, "*");
  }, [canRun, code, disabled, ready, revision]);

  useEffect(() => {
    if (!ready || disabled || !runtimeCommandId) return;

    const command: StrudelFrameCommand = runtimeEnabled
      ? {
          code: runtimeCode,
          commandId: runtimeCommandId,
          revision: createStrudelRevision(runtimeCode),
          source: "telepathy-strudel",
          type: "update",
        }
      : {
          commandId: runtimeCommandId,
          source: "telepathy-strudel",
          type: "stop",
        };
    frameRef.current?.contentWindow?.postMessage(command, "*");
  }, [
    disabled,
    ready,
    runtimeCode,
    runtimeCommandId,
    runtimeEnabled,
  ]);

  return (
    <iframe
      allow="autoplay"
      className="strudel-controls-frame"
      ref={frameRef}
      referrerPolicy="no-referrer"
      sandbox="allow-scripts"
      srcDoc={STRUDEL_FRAME_DOCUMENT}
      title="Strudel audio controls"
    />
  );
}

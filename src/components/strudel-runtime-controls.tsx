"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  createStrudelRevision,
  isStrudelFrameEvent,
  type StrudelFrameCommand,
  type StrudelRuntimeStatus,
} from "@/lib/room-strudel";
import { STRUDEL_FRAME_DOCUMENT } from "@/lib/strudel-frame-document";

interface StrudelRuntimeControlsProps {
  canRun: boolean;
  code: string;
  disabled: boolean;
  onStatusChange: (status: StrudelRuntimeStatus) => void;
}

export function StrudelRuntimeControls({
  canRun,
  code,
  disabled,
  onStatusChange,
}: StrudelRuntimeControlsProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const revision = useMemo(
    () => createStrudelRevision(code),
    [code],
  );

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
        return;
      }
      if (event.data.type === "stopped") {
        onStatusChange({ state: "stopped" });
        return;
      }
      if (
        event.data.revision !== revision &&
        !(event.data.revision === "" && !event.data.ok)
      ) {
        return;
      }

      if (event.data.ok) {
        onStatusChange({ state: "running" });
      } else {
        onStatusChange({
          error: event.data.error ?? "The pattern could not run.",
          state: "error",
        });
      }
    }

    window.addEventListener("message", handleFrameMessage);
    return () => window.removeEventListener("message", handleFrameMessage);
  }, [onStatusChange, revision]);

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

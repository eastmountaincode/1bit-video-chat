"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { HYDRA_FRAME_DOCUMENT } from "@/lib/hydra-frame-document";
import {
  createHydraRevision,
  isHydraFrameEvent,
  type HydraFrameCommand,
  type HydraRuntimeStatus,
} from "@/lib/room-hydra";

interface HydraBackgroundProps {
  code: string;
  onStatusChange: (status: HydraRuntimeStatus) => void;
  updatedAt: number;
}

export function HydraBackground({
  code,
  onStatusChange,
  updatedAt,
}: HydraBackgroundProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const revision = useMemo(
    () => createHydraRevision(code, updatedAt),
    [code, updatedAt],
  );

  useEffect(() => {
    onStatusChange({ state: "loading" });
  }, [onStatusChange, revision]);

  useEffect(() => {
    function handleFrameMessage(event: MessageEvent) {
      if (
        event.source !== frameRef.current?.contentWindow ||
        !isHydraFrameEvent(event.data)
      ) {
        return;
      }

      if (event.data.type === "ready") {
        setReady(true);
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
          error: event.data.error ?? "The sketch could not run.",
          state: "error",
        });
      }
    }

    window.addEventListener("message", handleFrameMessage);
    return () => window.removeEventListener("message", handleFrameMessage);
  }, [onStatusChange, revision]);

  useEffect(() => {
    if (!ready) return;

    const command: HydraFrameCommand = {
      code,
      revision,
      source: "telepathy-hydra",
      type: "run",
    };
    frameRef.current?.contentWindow?.postMessage(command, "*");
  }, [code, ready, revision]);

  return (
    <iframe
      aria-hidden="true"
      className="hydra-background"
      data-room-part="hydra-background"
      ref={frameRef}
      referrerPolicy="no-referrer"
      sandbox="allow-scripts"
      srcDoc={HYDRA_FRAME_DOCUMENT}
      tabIndex={-1}
      title="Hydra room background"
    />
  );
}

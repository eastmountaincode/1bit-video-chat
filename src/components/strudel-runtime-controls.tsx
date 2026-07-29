"use client";

import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import {
  createStrudelRevision,
  isStrudelFrameEvent,
  type StrudelFrameCommand,
} from "@/lib/room-strudel";
import { STRUDEL_FRAME_DOCUMENT } from "@/lib/strudel-frame-document";

interface StrudelRuntimeControlsProps {
  canRun: boolean;
  code: string;
  controlRef: RefObject<StrudelRuntimeControlsHandle | null>;
  disabled: boolean;
}

export interface StrudelRuntimeControlsHandle {
  stop: () => void;
  update: (code: string) => void;
}

export function StrudelRuntimeControls({
  canRun,
  code,
  controlRef,
  disabled,
}: StrudelRuntimeControlsProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const latestControlsRef = useRef({ canRun, disabled });
  const pendingUpdateRef = useRef<StrudelFrameCommand | null>(null);
  const requestedRevisionRef = useRef<string | null>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const revision = useMemo(
    () => createStrudelRevision(code),
    [code],
  );

  useImperativeHandle(
    controlRef,
    () => ({
      update(nextCode: string) {
        if (disabled || !canRun || !nextCode.trim()) return;

        const command: StrudelFrameCommand = {
          canRun,
          code: nextCode,
          disabled,
          revision: createStrudelRevision(nextCode),
          source: "telepathy-strudel",
          type: "update",
        };
        requestedRevisionRef.current = command.revision;
        if (readyRef.current) {
          frameRef.current?.contentWindow?.postMessage(command, "*");
        } else {
          pendingUpdateRef.current = command;
        }
      },
      stop() {
        pendingUpdateRef.current = null;
        requestedRevisionRef.current = null;
        const command: StrudelFrameCommand = {
          source: "telepathy-strudel",
          type: "stop",
        };
        frameRef.current?.contentWindow?.postMessage(command, "*");
      },
    }),
    [canRun, disabled],
  );

  useEffect(() => {
    latestControlsRef.current = { canRun, disabled };
    if (!canRun || disabled) {
      pendingUpdateRef.current = null;
      requestedRevisionRef.current = null;
    }
  }, [canRun, disabled]);

  useEffect(() => {
    function handleFrameMessage(event: MessageEvent) {
      if (
        event.source !== frameRef.current?.contentWindow ||
        !isStrudelFrameEvent(event.data)
      ) {
        return;
      }

      if (event.data.type === "ready") {
        readyRef.current = true;
        setReady(true);
        const pendingUpdate = pendingUpdateRef.current;
        pendingUpdateRef.current = null;
        const latestControls = latestControlsRef.current;
        if (
          pendingUpdate &&
          latestControls.canRun &&
          !latestControls.disabled
        ) {
          frameRef.current?.contentWindow?.postMessage(
            pendingUpdate,
            "*",
          );
        } else {
          requestedRevisionRef.current = null;
        }
        return;
      }
      if (event.data.type === "stopped") {
        requestedRevisionRef.current = null;
        return;
      }
      if (
        event.data.revision !== revision &&
        event.data.revision !== requestedRevisionRef.current &&
        !(event.data.revision === "" && !event.data.ok)
      ) {
        return;
      }

      requestedRevisionRef.current = null;
    }

    window.addEventListener("message", handleFrameMessage);
    return () => window.removeEventListener("message", handleFrameMessage);
  }, [revision]);

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

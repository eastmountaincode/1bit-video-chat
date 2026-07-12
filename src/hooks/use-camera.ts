"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CameraPermission =
  | "checking"
  | "prompt"
  | "granted"
  | "denied"
  | "unavailable";

export function useCamera() {
  const [permission, setPermission] =
    useState<CameraPermission>("checking");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const triedGrantedPermissionRef = useRef(false);

  const requestCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPermission("unavailable");
      return null;
    }

    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          height: { ideal: 480 },
          width: { ideal: 640 },
        },
      });

      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = nextStream;
      setStream(nextStream);
      setPermission("granted");
      return nextStream;
    } catch (error) {
      const isDenied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "SecurityError");
      setPermission(isDenied ? "denied" : "unavailable");
      return null;
    }
  }, []);

  useEffect(() => {
    let permissionStatus: PermissionStatus | null = null;
    let syncPermission: (() => void) | null = null;
    let cancelled = false;

    async function checkPermission() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPermission("unavailable");
        return;
      }

      try {
        permissionStatus = await navigator.permissions.query({
          name: "camera" as PermissionName,
        });
        if (cancelled) return;

        syncPermission = () => {
          if (!permissionStatus) return;
          setPermission(permissionStatus.state);
        };

        syncPermission();
        permissionStatus.addEventListener("change", syncPermission);
      } catch {
        setPermission("prompt");
      }
    }

    void checkPermission();

    return () => {
      cancelled = true;
      if (permissionStatus && syncPermission) {
        permissionStatus.removeEventListener("change", syncPermission);
      }
    };
  }, []);

  useEffect(() => {
    if (
      permission === "granted" &&
      !stream &&
      !triedGrantedPermissionRef.current
    ) {
      triedGrantedPermissionRef.current = true;
      void requestCamera();
    }
  }, [permission, requestCamera, stream]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  return { permission, requestCamera, stream };
}

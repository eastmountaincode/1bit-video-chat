"use client";

import { useState, type FormEvent } from "react";

import { GrayscaleCanvas } from "@/components/grayscale-canvas";
import type { CameraPermission } from "@/hooks/use-camera";
import { useGrayscaleCamera } from "@/hooks/use-grayscale-camera";

interface JoinSplashProps {
  permission: CameraPermission;
  requestCamera: () => Promise<MediaStream | null>;
  stream: MediaStream | null;
  onJoin: (name: string) => void;
}

const permissionLabels: Record<CameraPermission, string> = {
  checking: "checking",
  denied: "blocked",
  granted: "allowed",
  prompt: "not allowed yet",
  unavailable: "unavailable",
};

export function JoinSplash({
  onJoin,
  permission,
  requestCamera,
  stream,
}: JoinSplashProps) {
  const [name, setName] = useState("");
  const frame = useGrayscaleCamera(stream);
  const canJoin = name.trim().length > 0 && Boolean(stream && frame);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canJoin) onJoin(name.trim().slice(0, 24));
  }

  return (
    <main className="splash-page">
      <form className="join-form" onSubmit={handleSubmit}>
        <fieldset>
          <legend>Telepathy</legend>

          <p className="room-back-link">
            {/* A document navigation cannot carry this room's PlayHTML transport into the lobby. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/">
              <span aria-hidden="true">←</span> Back to room selection
            </a>
          </p>

          <p className="camera-status">
            Camera: {permissionLabels[permission]}
          </p>

          <figure className="preview-frame">
            <GrayscaleCanvas
              frame={frame}
              pixelOverlayEnabled={false}
            />
          </figure>

          <label className="name-field">
            name
            <input
              autoComplete="nickname"
              maxLength={24}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>

          <div className="button-row">
            {!stream && permission !== "unavailable" ? (
              <button
                disabled={permission === "checking" || permission === "denied"}
                onClick={() => void requestCamera()}
                type="button"
              >
                allow camera
              </button>
            ) : null}
            <button disabled={!canJoin} type="submit">
              join room
            </button>
          </div>

          {permission === "denied" ? (
            <p className="form-note">Allow camera access in browser settings.</p>
          ) : null}
        </fieldset>
      </form>
    </main>
  );
}

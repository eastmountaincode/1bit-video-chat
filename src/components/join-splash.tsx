"use client";

import { useState, type FormEvent } from "react";

import { GrayscaleCanvas } from "@/components/grayscale-canvas";
import { ResolutionControl } from "@/components/resolution-control";
import type { CameraPermission } from "@/hooks/use-camera";
import { useGrayscaleCamera } from "@/hooks/use-grayscale-camera";
import type { CaptureSettings } from "@/lib/capture-settings";

interface JoinSplashProps {
    captureSettings: CaptureSettings;
    onCaptureSettingsChange: (settings: CaptureSettings) => void;
  capacity: number;
  error: string | null;
  isJoining: boolean;
  participantCount: number;
  permission: CameraPermission;
  requestCamera: () => Promise<MediaStream | null>;
  roomName: string;
  stream: MediaStream | null;
  onJoin: (name: string) => Promise<void>;
}

export function JoinSplash({
    captureSettings,
    onCaptureSettingsChange,
  capacity,
  error,
  isJoining,
  onJoin,
  participantCount,
  permission,
  requestCamera,
  roomName,
  stream,
}: JoinSplashProps) {
  const [name, setName] = useState("");
    const frame = useGrayscaleCamera(stream, captureSettings);
  const canJoin =
    !isJoining &&
    participantCount < capacity &&
    name.trim().length > 0 &&
    Boolean(stream && frame);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canJoin) void onJoin(name.trim().slice(0, 24));
  }

  return (
    <main className="splash-page">
      <form className="join-form" onSubmit={handleSubmit}>
        <fieldset aria-label="Join room">
          <p className="room-back-link">
            {/* A document navigation cannot carry this room's PlayHTML transport into the lobby. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a className="room-back-button" href="/">
              <span aria-hidden="true">←</span> Back to room selection
            </a>
          </p>

          <p className="lobby-room-summary">
            Joining room: <strong>{roomName}</strong>{" "}
            <span className="room-participant-count">
              ({participantCount}/{capacity})
            </span>
          </p>

          <figure className="preview-frame">
            <GrayscaleCanvas frame={frame} />
          </figure>

            <ResolutionControl
                onChange={onCaptureSettingsChange}
                settings={captureSettings}
            />

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
            {!stream ? (
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

          {error ? (
            <p className="form-note error-note" role="alert">
              {error}
            </p>
          ) : null}

          {permission === "denied" ? (
            <p className="form-note">Allow camera access in browser settings.</p>
          ) : null}
            {permission === "unavailable" ? (
                <p className="form-note error-note" role="alert">
                    Camera unavailable. Check that a camera is connected and try again.
                </p>
            ) : null}
        </fieldset>
      </form>
    </main>
  );
}

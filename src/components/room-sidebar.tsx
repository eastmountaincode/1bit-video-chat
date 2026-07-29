"use client";

import { useState } from "react";

import { ChatPanel } from "@/components/chat-panel";
import { HelperPanel } from "@/components/helper-panel";
import { HydraPanel } from "@/components/hydra-panel";
import { StrudelPanel } from "@/components/strudel-panel";
import { StylePanel } from "@/components/style-panel";
import { useMobileLayout } from "@/hooks/use-mobile-layout";
import type { CaptureSettings } from "@/lib/capture-settings";
import type {
  HydraRuntimeStatus,
  RoomHydraData,
} from "@/lib/room-hydra";

export type SidebarPanel =
  | "chat"
  | "settings"
  | "style"
  | "hydra"
  | "strudel";

interface RoomSidebarProps {
  activePanel: SidebarPanel;
  captureSettings: CaptureSettings;
  hydraDisabled: boolean;
  hydraRuntimeStatus: HydraRuntimeStatus | null;
  name: string;
  onCaptureSettingsChange: (settings: CaptureSettings) => void;
  onHydraRun: (code: string) => void;
  onHydraStop: () => void;
  onLeave: () => void;
  onPanelChange: (panel: SidebarPanel) => void;
  roomHydra: RoomHydraData;
  roomName: string;
  strudelDisabled: boolean;
  videoConnectionStatus: string | null;
}

const panels: SidebarPanel[] = [
  "chat",
  "settings",
  "style",
  "hydra",
  "strudel",
];

export function RoomSidebar({
  activePanel,
  captureSettings,
  hydraDisabled,
  hydraRuntimeStatus,
  name,
  onCaptureSettingsChange,
  onHydraRun,
  onHydraStop,
  onLeave,
  onPanelChange,
  roomHydra,
  roomName,
  strudelDisabled,
  videoConnectionStatus,
}: RoomSidebarProps) {
  const isMobile = useMobileLayout();
  const [strudelRuntimeEnabled, setStrudelRuntimeEnabled] = useState(
    activePanel === "strudel",
  );

  function selectPanel(panel: SidebarPanel) {
    if (panel === "strudel") {
      setStrudelRuntimeEnabled(true);
    }

    if (isMobile && panel !== "chat" && activePanel === panel) {
      onPanelChange("chat");
      return;
    }

    onPanelChange(panel);
  }

  return (
    <aside
      className="room-sidebar"
      data-room-part="sidebar"
      id="room-interactive-panel"
    >
      <header className="room-sidebar-header">
        <div className="room-sidebar-toolbar">
          <nav
            aria-label="Room panels"
            className="sidebar-tabs"
            data-room-part="sidebar-tabs"
          >
            {panels.map((panel) => (
              <button
                aria-pressed={activePanel === panel}
                className={`sidebar-tab sidebar-tab-${panel}`}
                key={panel}
                onClick={() => selectPanel(panel)}
                type="button"
              >
                {panel === "style" ? "css" : panel}
              </button>
            ))}
            <button
              className="leave-button"
              data-room-part="leave"
              onClick={onLeave}
              type="button"
            >
              leave room
            </button>
          </nav>
          <p className="room-current-name">
            room: <strong>{roomName}</strong>
          </p>
        </div>
        {videoConnectionStatus ? (
          <p className="video-connection-note" role="status">
            {videoConnectionStatus}
          </p>
        ) : null}
      </header>

      <div className="sidebar-panels">
        <ChatPanel active={activePanel === "chat"} name={name} />
        <HelperPanel
          active={activePanel === "settings"}
          onChange={onCaptureSettingsChange}
          settings={captureSettings}
        />
        <StylePanel active={activePanel === "style"} name={name} />
        <HydraPanel
          active={activePanel === "hydra"}
          disabled={hydraDisabled}
          hydra={roomHydra}
          name={name}
          onRun={onHydraRun}
          onStop={onHydraStop}
          runtimeStatus={hydraRuntimeStatus}
        />
        <StrudelPanel
          active={activePanel === "strudel"}
          disabled={strudelDisabled}
          name={name}
          runtimeEnabled={strudelRuntimeEnabled}
        />
      </div>
    </aside>
  );
}

"use client";

import { ChatPanel } from "@/components/chat-panel";
import { HelperPanel } from "@/components/helper-panel";
import { StylePanel } from "@/components/style-panel";
import { useMobileLayout } from "@/hooks/use-mobile-layout";
import type { CaptureSettings } from "@/lib/capture-settings";

export type SidebarPanel = "chat" | "settings" | "style";

interface RoomSidebarProps {
  activePanel: SidebarPanel;
  captureSettings: CaptureSettings;
  name: string;
  onCaptureSettingsChange: (settings: CaptureSettings) => void;
  onPanelChange: (panel: SidebarPanel) => void;
}

const panels: SidebarPanel[] = ["chat", "settings", "style"];

export function RoomSidebar({
  activePanel,
  captureSettings,
  name,
  onCaptureSettingsChange,
  onPanelChange,
}: RoomSidebarProps) {
  const isMobile = useMobileLayout();

  function selectPanel(panel: SidebarPanel) {
    if (isMobile && panel !== "chat" && activePanel === panel) {
      onPanelChange("chat");
      return;
    }

    onPanelChange(panel);
  }

  return (
    <aside className="room-sidebar" data-room-part="sidebar">
      <header className="room-sidebar-header">
        <p className="room-site-title" data-room-part="title">
          Telepathy
        </p>
        <nav aria-label="Room panels" className="sidebar-tabs" data-room-part="sidebar-tabs">
          {panels.map((panel) => (
            <button
              aria-pressed={activePanel === panel}
              className={`sidebar-tab sidebar-tab-${panel}`}
              key={panel}
              onClick={() => selectPanel(panel)}
              type="button"
            >
              {panel}
            </button>
          ))}
        </nav>
      </header>

      <div className="sidebar-panels">
        <ChatPanel active={activePanel === "chat"} name={name} />
        <HelperPanel
          active={activePanel === "settings"}
          onChange={onCaptureSettingsChange}
          settings={captureSettings}
        />
        <StylePanel active={activePanel === "style"} name={name} />
      </div>
    </aside>
  );
}

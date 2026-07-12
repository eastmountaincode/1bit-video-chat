"use client";

import { usePageData } from "@playhtml/react";
import { useEffect, useRef, useState } from "react";

import {
  DEFAULT_ROOM_STYLE,
  ensureRoomStyleScaffold,
  MAX_ROOM_CSS_LENGTH,
  ROOM_STYLE_SCAFFOLD,
  type RoomStyleData,
} from "@/lib/room-style";

interface StylePanelProps {
  active: boolean;
  name: string;
}

export function StylePanel({ active, name }: StylePanelProps) {
  const [sharedStyle, setSharedStyle] = usePageData<RoomStyleData>(
    "room-style:v1",
    DEFAULT_ROOM_STYLE,
  );
  const [draft, setDraft] = useState(ROOM_STYLE_SCAFFOLD);
  const lastPublishedCss = useRef(ROOM_STYLE_SCAFFOLD);

  useEffect(() => {
    if (sharedStyle.css === lastPublishedCss.current) return;
    const normalizedCss = ensureRoomStyleScaffold(sharedStyle.css);
    lastPublishedCss.current = normalizedCss;
    setDraft(normalizedCss);
  }, [sharedStyle.css]);

  useEffect(() => {
    const publishTimer = window.setTimeout(() => {
      const normalizedCss = ensureRoomStyleScaffold(draft);

      if (normalizedCss !== draft) {
        setDraft(normalizedCss);
      }

      if (normalizedCss === sharedStyle.css) return;

      lastPublishedCss.current = normalizedCss;
      setSharedStyle({
        css: normalizedCss,
        updatedAt: Date.now(),
        updatedBy: name,
        version: 1,
      });
    }, 300);

    return () => window.clearTimeout(publishTimer);
  }, [draft, name, setSharedStyle, sharedStyle.css]);

  function resetRoomStyle() {
    lastPublishedCss.current = ROOM_STYLE_SCAFFOLD;
    setDraft(ROOM_STYLE_SCAFFOLD);
    setSharedStyle({
      css: ROOM_STYLE_SCAFFOLD,
      updatedAt: Date.now(),
      updatedBy: name,
      version: 1,
    });
  }

  return (
    <>
      <style data-telepathy-room-style>{draft}</style>
      <fieldset
        className="style-panel sidebar-panel"
        data-room-part="style"
        hidden={!active}
      >
        <legend>style</legend>
        <textarea
          aria-label="room css"
          className="style-editor"
          maxLength={MAX_ROOM_CSS_LENGTH}
          onChange={(event) =>
            setDraft(event.target.value.slice(0, MAX_ROOM_CSS_LENGTH))
          }
          spellCheck={false}
          value={draft}
        />
        <div className="style-panel-footer">
          <output>
            {draft.length.toLocaleString()} / {MAX_ROOM_CSS_LENGTH.toLocaleString()}
          </output>
          <button onClick={resetRoomStyle} type="button">
            reset room style
          </button>
        </div>
        {sharedStyle.updatedBy ? (
          <small>last changed by {sharedStyle.updatedBy}</small>
        ) : null}
      </fieldset>
    </>
  );
}

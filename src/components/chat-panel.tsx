"use client";

import { usePageData, usePlayContext } from "@playhtml/react";
import { memo, useEffect, useRef, useState, type FormEvent } from "react";

import { useMobileLayout } from "@/hooks/use-mobile-layout";
import type { ChatLedger } from "@/lib/shared-types";

const MAX_MESSAGES = 200;
const defaultLedger: ChatLedger = { messages: [], version: 1 };

interface ChatPanelProps {
  name: string;
}

export const ChatPanel = memo(function ChatPanel({ name }: ChatPanelProps) {
  const [ledger, setLedger] = usePageData<ChatLedger>(
    "global-chat:v1",
    defaultLedger,
  );
  const { isLoading } = usePlayContext();
  const [message, setMessage] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const isMobile = useMobileLayout();
  const isVisible = !isMobile || isOpen;
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (isVisible) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }
  }, [isVisible, ledger.messages.length]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || isLoading) return;

    setLedger((draft) => {
      draft.version = 1;
      draft.messages ??= [];
      draft.messages.push({
        author: name,
        id: crypto.randomUUID(),
        sentAt: Date.now(),
        text: text.slice(0, 500),
      });

      if (draft.messages.length > MAX_MESSAGES) {
        draft.messages.splice(0, draft.messages.length - MAX_MESSAGES);
      }
    });
    setMessage("");
  }

  return (
    <aside className={`chat-column${isOpen ? " chat-open" : ""}`}>
      <div className="chat-toggle-bar">
        <button
          aria-controls="chat-drawer"
          aria-expanded={isVisible}
          aria-label={isOpen ? "Close chat" : "Open chat"}
          className="chat-toggle-button"
          onClick={() => setIsOpen((open) => !open)}
          type="button"
        >
          chat
        </button>
      </div>

      <div className="chat-drawer" hidden={!isVisible} id="chat-drawer">
        <fieldset className="chat-fieldset">
          <legend>chat</legend>
          <p className="chat-site-title">Sesame Chat</p>

          <ol className="message-list" ref={listRef}>
            {ledger.messages.length === 0 ? <li>no messages yet</li> : null}
            {ledger.messages.map((item) => (
              <li key={item.id}>
                <span className="message-meta">
                  <strong>{item.author}</strong>{" "}
                  <time dateTime={new Date(item.sentAt).toISOString()}>
                    {new Date(item.sentAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </span>
                <span>{item.text}</span>
              </li>
            ))}
          </ol>

          <form className="chat-form" onSubmit={handleSubmit}>
            <label htmlFor="chat-message">message</label>
            <textarea
              disabled={isLoading}
              id="chat-message"
              maxLength={500}
              onChange={(event) => setMessage(event.target.value)}
              rows={3}
              value={message}
            />
            <button
              disabled={isLoading || message.trim().length === 0}
              type="submit"
            >
              send
            </button>
          </form>
        </fieldset>
      </div>
    </aside>
  );
});

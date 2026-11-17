"use client";

import { usePageData, usePlayContext } from "@playhtml/react";
import { memo, useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";

import { useMobileLayout } from "@/hooks/use-mobile-layout";
import { useMobileChatViewport } from "@/hooks/use-mobile-chat-viewport";
import { usePageScrollLock } from "@/hooks/use-page-scroll-lock";
import type { ChatLedger } from "@/lib/shared-types";

const MAX_MESSAGES = 200;
const defaultLedger: ChatLedger = { messages: [], version: 1 };

interface ChatPanelProps {
  active: boolean;
  name: string;
    ownerId: string;
}

export const ChatPanel = memo(function ChatPanel({ active, name, ownerId }: ChatPanelProps) {
  const [ledger, setLedger] = usePageData<ChatLedger>(
    "global-chat:v1",
    defaultLedger,
  );
  const { isLoading } = usePlayContext();
  const [message, setMessage] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const isMobile = useMobileLayout();
  const isVisible = isMobile ? isOpen : active;
  const listRef = useRef<HTMLOListElement>(null);
    const panelRef = useRef<HTMLElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    usePageScrollLock(isMobile && isOpen);
    useMobileChatViewport(panelRef, isMobile);

    function keepInputFocus(event: PointerEvent<HTMLButtonElement>) {
        // Keep the keyboard from moving a tapped control before its click arrives.
        if (isMobile && document.activeElement === inputRef.current) event.preventDefault();
    }

    function toggleChat() {
        if (isOpen) inputRef.current?.blur();
        setIsOpen((open) => !open);
    }

  useEffect(() => {
    if (isVisible) {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    }
  }, [isVisible, ledger.messages.length]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || isLoading || !ownerId) return;

    setLedger((draft) => {
      draft.version = 1;
      draft.messages ??= [];
      draft.messages.push({
        author: name,
        authorId: ownerId,
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

  const chatForm = (
    <form className="chat-form" onSubmit={handleSubmit}>
      <label htmlFor="chat-message">message</label>
      {isMobile ? (
        <input
          aria-label="message"
          disabled={isLoading}
          id="chat-message"
          maxLength={500}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="type message..."
          ref={inputRef}
          type="text"
          value={message}
        />
      ) : (
        <textarea
          disabled={isLoading}
          id="chat-message"
          maxLength={500}
          onChange={(event) => setMessage(event.target.value)}
          rows={3}
          value={message}
        />
      )}
      <button
        aria-label={isMobile ? "Send message" : undefined}
        className="chat-submit-button"
        disabled={isLoading || message.trim().length === 0}
        onPointerDown={keepInputFocus}
        type="submit"
      >
        {isMobile ? (
          <svg
            aria-hidden="true"
            className="chat-submit-icon"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path d="M22 2 11 13" />
            <path d="m22 2-7 20-4-9-9-4Z" />
          </svg>
        ) : (
          "send"
        )}
      </button>
    </form>
  );

  return (
    <section className={`chat-panel${isOpen ? " chat-open" : ""}`} ref={panelRef}>
      <div className="chat-drawer" hidden={!isVisible} id="chat-drawer">
        <fieldset className="chat-fieldset" data-room-part="chat">
          <legend>chat</legend>

          <ol className="message-list" ref={listRef}>
            {ledger.messages.length === 0 ? <li>no messages yet</li> : null}
            {ledger.messages.map((item) => (
              <li
                className={(item.authorId ? item.authorId === ownerId : item.author === name) ? "message-own" : undefined}
                data-side={(item.authorId ? item.authorId === ownerId : item.author === name) ? "own" : "other"}
                data-room-part="message"
                data-style-owner={item.authorId}
                key={item.id}
              >
                <span className="message-meta">
                    <strong
                        data-room-part="message-author"
                        data-style-owner={item.authorId}
                        data-side={(item.authorId ? item.authorId === ownerId : item.author === name) ? "own" : "other"}
                    >{item.author}</strong>{" "}
                    <time
                        data-room-part="message-time"
                        data-style-owner={item.authorId}
                        data-side={(item.authorId ? item.authorId === ownerId : item.author === name) ? "own" : "other"}
                        dateTime={new Date(item.sentAt).toISOString()}
                    >
                    {new Date(item.sentAt).toLocaleString([], {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </span>
                <span
                    data-room-part="message-text"
                    data-style-owner={item.authorId}
                    data-side={(item.authorId ? item.authorId === ownerId : item.author === name) ? "own" : "other"}
                >{item.text}</span>
              </li>
            ))}
          </ol>

          {!isMobile ? chatForm : null}
        </fieldset>
      </div>

      <div className="chat-control-bar">
        {isMobile && isOpen ? chatForm : null}
        <button
          aria-controls="chat-drawer"
          aria-expanded={isVisible}
          aria-label={isOpen ? "Close chat" : "Open chat"}
          className="chat-toggle-button"
          onClick={toggleChat}
          onPointerDown={keepInputFocus}
          type="button"
        >
          chat
        </button>
      </div>
    </section>
  );
});

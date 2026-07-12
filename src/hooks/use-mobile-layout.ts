"use client";

import { useSyncExternalStore } from "react";

const MOBILE_QUERY = "(max-width: 720px)";

function subscribe(callback: () => void) {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

function getServerSnapshot() {
  return false;
}

export function useMobileLayout() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

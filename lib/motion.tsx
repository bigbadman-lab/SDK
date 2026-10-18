"use client";

import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export const softEase = [0.22, 1, 0.36, 1] as const;
const MOTION_KEY = "agentframe-reduced-motion";
const MOTION_EVENT = "agentframe:motion";
let memoryPreference = false;

function subscribe(callback: () => void): () => void {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  window.addEventListener("storage", callback);
  window.addEventListener(MOTION_EVENT, callback);
  return () => {
    query.removeEventListener("change", callback);
    window.removeEventListener("storage", callback);
    window.removeEventListener(MOTION_EVENT, callback);
  };
}

function getSnapshot(): boolean {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    return true;
  try {
    return localStorage.getItem(MOTION_KEY) === "true";
  } catch {
    return memoryPreference;
  }
}

const ReducedMotionContext = createContext(false);

export function useReducedMotion(): boolean {
  return useContext(ReducedMotionContext);
}

export function useSystemReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false
  );
}

export function toggleMotionPreference(): void {
  memoryPreference = !getSnapshot();
  try {
    localStorage.setItem(MOTION_KEY, String(memoryPreference));
  } catch {}
  window.dispatchEvent(new Event(MOTION_EVENT));
}

export function ReducedMotionProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const reduced = useSyncExternalStore(subscribe, getSnapshot, () => false);
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reduced);
    return () => {
      delete document.documentElement.dataset.reducedMotion;
    };
  }, [reduced]);
  return (
    <ReducedMotionContext.Provider value={reduced}>
      {children}
    </ReducedMotionContext.Provider>
  );
}

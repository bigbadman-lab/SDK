"use client";

import { Moon, Pause, Play, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore, type ReactNode } from "react";
import {
  toggleMotionPreference,
  useReducedMotion,
  useSystemReducedMotion,
} from "@/lib/motion";

const subscribe = (): (() => void) => () => {};

export function ThemeSwitch(): ReactNode {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );
  const { setTheme, resolvedTheme } = useTheme();
  const reduced = useReducedMotion();
  const dark = resolvedTheme === "dark";
  const systemReduced = useSystemReducedMotion();
  return (
    <div
      className="fixed right-4 bottom-4 z-65 flex items-center gap-0.5 rounded-lg border border-solid border-border bg-card p-0.75 max-[800px]:bottom-[calc(5.5rem+env(safe-area-inset-bottom))] max-[561px]:right-3"
      aria-label="Appearance preferences"
    >
      <button
        className="grid h-7.5 w-7.5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={
          systemReduced
            ? "Reduced motion follows your system"
            : reduced
              ? "Enable animations"
              : "Pause animations"
        }
        aria-pressed={reduced}
        disabled={!mounted || systemReduced}
        onClick={toggleMotionPreference}
        type="button"
        title={
          systemReduced
            ? "Reduced motion follows your system"
            : reduced
              ? "Enable animations"
              : "Pause animations"
        }
      >
        {reduced ? <Play size={15} /> : <Pause size={15} />}
      </button>
      <span className="h-3 w-px bg-border" />
      <button
        className="grid h-7.5 w-7.5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={
          !mounted
            ? "Toggle color theme"
            : dark
              ? "Switch to light theme"
              : "Switch to dark theme"
        }
        aria-pressed={mounted && dark}
        disabled={!mounted}
        onClick={() => setTheme(dark ? "light" : "dark")}
        type="button"
        title={
          !mounted ? "Toggle color theme" : dark ? "Light mode" : "Dark mode"
        }
      >
        {mounted && dark ? <Sun size={17} /> : <Moon size={17} />}
      </button>
    </div>
  );
}

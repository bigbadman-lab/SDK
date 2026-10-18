"use client";

import { useEffect, type ReactNode } from "react";

import { touchSession } from "@/lib/server/session-action";

export function SessionTouch(): ReactNode {
  useEffect(() => {
    void touchSession();
  }, []);
  return null;
}

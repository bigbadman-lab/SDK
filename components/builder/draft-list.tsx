"use client";

import { useEffect, useState, type ReactNode } from "react";

type Draft = { id: string; name: string; description: string; updatedAt: string };

export function DraftList(): ReactNode {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const session = await fetch("/api/auth/session", { credentials: "same-origin" });
      const current = (await session.json()) as { authenticated?: boolean };
      if (!active || current.authenticated !== true) return;
      const response = await fetch("/api/builder/drafts", { credentials: "same-origin" });
      const body = (await response.json()) as { drafts?: Draft[]; error?: string };
      if (!active) return;
      if (!response.ok) {
        setNotice(body.error ?? "Drafts are unavailable.");
        return;
      }
      setDrafts(body.drafts ?? []);
    })();
    return () => {
      active = false;
    };
  }, []);

  if (notice) return <p className="font-mono text-[11px] text-muted-foreground">{notice}</p>;
  if (!drafts) return null;
  if (drafts.length === 0) {
    return (
      <p className="text-[15px] leading-[1.7] text-muted-foreground">
        No private drafts yet. A draft is not a launched product.
      </p>
    );
  }
  return (
    <ul className="grid gap-3">
      {drafts.map((draft) => (
        <li key={draft.id}>
          <a className="grid gap-1" href={`/?draft=${draft.id}#builder`}>
            <span className="text-[15px]">{draft.name}</span>
            <span className="text-[13px] text-muted-foreground">{draft.description}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

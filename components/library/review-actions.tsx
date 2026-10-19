"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

export function ReviewActions({ submissionId }: { submissionId: string }): ReactNode {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function review(action: "approve" | "reject"): Promise<void> {
    if (pending) return;
    if (action === "reject" && note.trim().length < 1) {
      setMessage("Enter a review reason up to 500 characters.");
      return;
    }
    setPending(action);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/library/submissions/${submissionId}/${action}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "reject" ? { note } : {}),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "The review could not be saved.");
        return;
      }
      router.refresh();
    } catch {
      setMessage("The review could not be saved.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid gap-3 border-t border-t-border pt-4">
      <label className="grid gap-1 font-mono text-[10px] text-muted-foreground uppercase">
        Rejection reason
        <textarea
          value={note}
          rows={3}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
          className="rounded-lg border border-solid border-border bg-background px-3 py-2 font-sans text-[14px] text-foreground normal-case"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => void review("approve")}
          className="rounded-lg border border-solid border-accent bg-accent px-3 py-2 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase disabled:opacity-60"
        >
          {pending === "approve" ? "Approving" : "Approve"}
        </button>
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => void review("reject")}
          className="rounded-lg border border-solid border-border bg-background px-3 py-2 font-mono text-[10px] tracking-[0.04em] uppercase disabled:opacity-60"
        >
          {pending === "reject" ? "Rejecting" : "Reject"}
        </button>
      </div>
      {message ? <p className="text-[13px] text-muted-foreground">{message}</p> : null}
    </div>
  );
}

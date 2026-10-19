"use client";

import { launchAction } from "@/lib/blueprint/save";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";

type Draft = {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  status: "saved_draft";
  tested: boolean;
  versionId: string | null;
};

export function DraftList(): ReactNode {
  return (
    <Suspense fallback={null}>
      <SavedSdkList />
    </Suspense>
  );
}

function SavedSdkList(): ReactNode {
  const params = useSearchParams();
  const selectedId = params.get("sdk");
  const justSaved = params.get("saved") === "1";
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [target, setTarget] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const session = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
      const current = (await session.json()) as { authenticated?: boolean };
      if (!active || current.authenticated !== true) return;
      const response = await fetch("/api/builder/drafts", { credentials: "same-origin" });
      const body = (await response.json()) as { drafts?: Draft[]; error?: string };
      if (!active) return;
      if (!response.ok) {
        setNotice(body.error ?? "Saved SDKs are unavailable.");
        return;
      }
      setDrafts(body.drafts ?? []);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId || !drafts) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(`sdk-${selectedId}`)?.scrollIntoView({
      block: "center",
      behavior: reduced ? "auto" : "smooth",
    });
  }, [selectedId, drafts]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (target && !dialog.open) dialog.showModal();
    if (!target && dialog.open) dialog.close();
  }, [target]);

  async function confirmDelete(): Promise<void> {
    if (!target || deleting) return;
    setDeleting(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/builder/drafts/${target.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const body = (await response.json()) as { error?: string; deleted?: boolean };
      if (!response.ok || body.deleted !== true) {
        setNotice(body.error ?? "The SDK could not be deleted.");
        return;
      }
      setDrafts((current) => current?.filter((draft) => draft.id !== target.id) ?? []);
      setNotice(`${target.name} was removed from My SDKs.`);
      setTarget(null);
    } catch {
      setNotice("The SDK could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  const selected = drafts?.find((draft) => draft.id === selectedId) ?? null;

  return (
    <section className="grid gap-3" aria-labelledby="my-sdks-title">
      <h2 id="my-sdks-title" className="font-mono text-[11px] tracking-[0.08em] uppercase">
        My SDKs
      </h2>
      {justSaved && selected ? (
        <p className="font-mono text-[11px] text-accent-ink uppercase" aria-live="polite">
          SDK saved successfully.
        </p>
      ) : null}
      {notice ? (
        <p className="font-mono text-[11px] text-muted-foreground" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {drafts && drafts.length === 0 ? (
        <p className="text-[15px] leading-[1.7] text-muted-foreground">
          No saved SDKs yet. A blueprint appears here after you test it and choose a name. It is not a launched product.
        </p>
      ) : null}
      {drafts && drafts.length > 0 ? (
        <ul className="grid gap-4">
          {drafts.map((draft) => {
            const launch = launchAction({ sdkId: draft.id, versionId: draft.versionId });
            return (
              <li
                key={draft.id}
                id={`sdk-${draft.id}`}
                data-sdk-id={launch.sdkId}
                data-version-id={launch.versionId ?? ""}
                className="grid scroll-mt-24 gap-3 border-t border-t-border pt-4"
              >
                <span className="text-[15px]">{draft.name}</span>
                <span className="text-[13px] leading-[1.5] text-muted-foreground">{draft.description}</span>
                <span className="font-mono text-[10px] text-muted-foreground uppercase">
                  Saved draft · {formatSavedAt(draft.updatedAt)} · {draft.tested ? "Tested" : "Not tested"} · Not launched
                </span>
                <button
                  type="button"
                  disabled
                  data-sdk-id={launch.sdkId}
                  data-version-id={launch.versionId ?? ""}
                  aria-label={`Launch ${draft.name}. Coming soon.`}
                  className="justify-self-start cursor-not-allowed rounded-lg border border-solid border-accent bg-accent px-3 py-2 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase"
                >
                  Launch · {launch.label}
                </button>
                <span className="flex flex-wrap gap-4 font-mono text-[10px] tracking-[0.04em] uppercase">
                  <a className="underline" href={`/build?draft=${draft.id}`}>
                    Edit
                  </a>
                  <a className="underline" href={`/build?draft=${draft.id}&intent=test`}>
                    Test
                  </a>
                  <button type="button" className="underline" onClick={() => setTarget(draft)}>
                    Delete
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <dialog
        ref={dialogRef}
        aria-labelledby="delete-sdk-title"
        className="w-[min(420px,calc(100%-32px))] rounded-[14px] border border-solid border-border bg-card p-5 text-foreground backdrop:bg-[#00000080]"
        onClose={() => {
          if (!deleting) setTarget(null);
        }}
      >
        <h3 id="delete-sdk-title" className="text-[18px]">
          Delete {target?.name ?? "this SDK"}?
        </h3>
        <p className="mt-3 text-[14px] leading-[1.6] text-muted-foreground">
          {target?.name ?? "This SDK"} will be removed from My SDKs. It will no longer open, edit, or test.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            autoFocus
            disabled={deleting}
            onClick={() => setTarget(null)}
            className="rounded-lg border border-solid border-border bg-background px-3 py-2 font-mono text-[10px] tracking-[0.04em] uppercase disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => void confirmDelete()}
            className="rounded-lg border border-solid border-accent bg-accent px-3 py-2 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase disabled:opacity-60"
          >
            {deleting ? "Deleting" : "Confirm delete"}
          </button>
        </div>
      </dialog>
    </section>
  );
}

function formatSavedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(date);
}

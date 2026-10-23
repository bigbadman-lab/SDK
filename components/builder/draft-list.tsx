"use client";

import { AccountSectionHeading } from "@/components/account/account-skeleton";
import { HomeLink } from "@/components/home/chrome";
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
  contentHash: string | null;
  originatorLabel: string;
  submitterIsOriginator: boolean;
};

type Submission = {
  draftId: string;
  contentHash: string;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  librarySdkId: string | null;
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
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [target, setTarget] = useState<Draft | null>(null);
  const [submitTarget, setSubmitTarget] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submitRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const session = await fetch("/api/auth/session", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const current = (await session.json()) as { authenticated?: boolean };
      if (!active || current.authenticated !== true) return;
      const response = await fetch("/api/builder/drafts", {
        credentials: "same-origin",
      });
      const body = (await response.json()) as {
        drafts?: Draft[];
        error?: string;
      };
      if (!active) return;
      if (!response.ok) {
        setNotice(body.error ?? "Saved SDKs are unavailable.");
        return;
      }
      setDrafts(body.drafts ?? []);
      const review = await fetch("/api/library/submissions", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const reviewBody = (await review.json()) as {
        submissions?: Submission[];
        remaining?: number;
        error?: string;
      };
      if (!active) return;
      if (!review.ok) {
        setSubmissions(null);
        setNotice(reviewBody.error ?? "Library submission is unavailable.");
        return;
      }
      setSubmissions(reviewBody.submissions ?? []);
      setRemaining(reviewBody.remaining ?? 0);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedId || !drafts) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
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

  useEffect(() => {
    const dialog = submitRef.current;
    if (!dialog) return;
    if (submitTarget && !dialog.open) dialog.showModal();
    if (!submitTarget && dialog.open) dialog.close();
  }, [submitTarget]);

  async function confirmDelete(): Promise<void> {
    if (!target || deleting) return;
    setDeleting(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/builder/drafts/${target.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const body = (await response.json()) as {
        error?: string;
        deleted?: boolean;
      };
      if (!response.ok || body.deleted !== true) {
        setNotice(body.error ?? "The SDK could not be deleted.");
        return;
      }
      setDrafts(
        (current) => current?.filter((draft) => draft.id !== target.id) ?? []
      );
      setNotice(`${target.name} was removed from My SDKs.`);
      setTarget(null);
    } catch {
      setNotice("The SDK could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  async function confirmSubmit(): Promise<void> {
    if (!submitTarget || submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      const response = await fetch("/api/library/submissions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: submitTarget.id }),
      });
      const body = (await response.json()) as Submission & {
        error?: string;
        remaining?: number;
        created?: boolean;
      };
      if (!response.ok) {
        if (typeof body.remaining === "number") setRemaining(body.remaining);
        setNotice(body.error ?? "The SDK could not be submitted.");
        return;
      }
      setSubmissions((current) => {
        const next = (current ?? []).filter(
          (item) =>
            !(
              item.draftId === submitTarget.id &&
              item.contentHash === body.contentHash
            )
        );
        next.unshift({
          draftId: submitTarget.id,
          contentHash: body.contentHash,
          status: body.status,
          note: body.note,
          librarySdkId: body.librarySdkId,
        });
        return next;
      });
      if (typeof body.remaining === "number") setRemaining(body.remaining);
      setNotice(
        body.created
          ? `${submitTarget.name} is in review. Submission does not launch a token.`
          : `${submitTarget.name} was already submitted.`
      );
      setSubmitTarget(null);
    } catch {
      setNotice("The SDK could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  }

  const selected = drafts?.find((draft) => draft.id === selectedId) ?? null;
  const targetPublished = target
    ? submissions?.some(
        (item) => item.draftId === target.id && item.status === "approved"
      ) === true
    : false;

  return (
    <section className="grid gap-5 border-t border-border pt-8" aria-labelledby="my-sdks-title">
      <AccountSectionHeading index="01" title="My SDKs" titleId="my-sdks-title">
        Your saved SDKs, tests and Library submissions.
      </AccountSectionHeading>
      {remaining === 0 ? (
        <p className="font-mono text-[11px] text-muted-foreground">
          Three community submissions are allowed each day.
        </p>
      ) : null}
      {justSaved && selected ? (
        <p
          className="font-mono text-[11px] text-accent-ink uppercase"
          aria-live="polite"
        >
          SDK saved successfully.
        </p>
      ) : null}
      {notice ? (
        <p
          className="font-mono text-[11px] text-muted-foreground"
          aria-live="polite"
        >
          {notice}
        </p>
      ) : null}
      {drafts === null && !notice ? (
        <div aria-busy="true">
          <p className="sr-only">Loading saved SDKs</p>
          <span className="block h-16 motion-safe:animate-pulse bg-muted" />
        </div>
      ) : null}
      {drafts && drafts.length === 0 ? (
        <div className="grid gap-4">
          <p className="text-[15px] leading-[1.7] text-muted-foreground">
            No SDKs saved yet. Create your first SDK in the AI Builder.
          </p>
          <HomeLink href="/build" tone="secondary">Open Builder</HomeLink>
        </div>
      ) : null}
      {drafts && drafts.length > 0 ? (
        <ul className="grid gap-4">
          {drafts.map((draft) => {
            const launch = launchAction({
              sdkId: draft.id,
              tested: draft.tested,
            });
            const current = submissions?.find(
              (item) =>
                item.draftId === draft.id &&
                item.contentHash === draft.contentHash
            );
            const published = submissions?.find(
              (item) => item.draftId === draft.id && item.status === "approved"
            );
            const olderPending =
              submissions?.some(
                (item) =>
                  item.draftId === draft.id &&
                  item.status === "pending" &&
                  item.contentHash !== draft.contentHash
              ) === true;
            const reviewLabel =
              current?.status === "pending"
                ? "In review"
                : current?.status === "approved"
                  ? "Approved"
                  : current?.status === "rejected"
                    ? "Rejected"
                    : "Not submitted";
            const canSubmit = Boolean(
              submissions &&
              draft.tested &&
              draft.contentHash &&
              !current &&
              remaining !== null &&
              remaining > 0
            );
            return (
              <li
                key={draft.id}
                id={`sdk-${draft.id}`}
                data-sdk-id={launch.sdkId}
                data-version-id={draft.versionId ?? ""}
                className="grid scroll-mt-24 gap-3 border-t border-t-border pt-4"
              >
                <span className="text-[15px]">{draft.name}</span>
                <span className="text-[13px] leading-[1.5] text-muted-foreground">
                  {draft.description}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground uppercase">
                  Saved draft · {formatSavedAt(draft.updatedAt)} ·{" "}
                  {draft.tested ? "Tested" : "Not tested"} · {reviewLabel} · Not
                  launched
                </span>
                {olderPending ? (
                  <span className="text-[13px] leading-[1.5] text-muted-foreground">
                    A previous revision is still in review.
                  </span>
                ) : null}
                {current?.status === "rejected" && current.note ? (
                  <span className="text-[13px] leading-[1.5] text-muted-foreground">
                    Review note: {current.note}
                  </span>
                ) : null}
                {published?.librarySdkId ? (
                  <a
                    className="font-mono text-[10px] tracking-[0.04em] uppercase underline"
                    href={`/library/${published.librarySdkId}`}
                  >
                    View in Library
                  </a>
                ) : null}
                {launch.href ? (
                  <a
                    href={launch.href}
                    data-sdk-id={launch.sdkId}
                    className="justify-self-start rounded-lg border border-solid border-accent bg-accent px-3 py-2 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase"
                  >
                    Launch
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    data-sdk-id={launch.sdkId}
                    aria-label={`Launch ${draft.name}. Test this SDK first.`}
                    className="cursor-not-allowed justify-self-start rounded-lg border border-solid border-accent bg-accent px-3 py-2 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase"
                  >
                    Launch · Test first
                  </button>
                )}
                <span className="flex flex-wrap gap-4 font-mono text-[10px] tracking-[0.04em] uppercase">
                  <a className="underline" href={`/build?draft=${draft.id}`}>
                    Edit
                  </a>
                  <a
                    className="underline"
                    href={`/build?draft=${draft.id}&intent=test`}
                  >
                    Test
                  </a>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => setTarget(draft)}
                  >
                    Delete
                  </button>
                  {canSubmit ? (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => setSubmitTarget(draft)}
                    >
                      Submit to Library
                    </button>
                  ) : null}
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
          {target?.name ?? "This SDK"} will be removed from My SDKs. It will no
          longer open, edit, or test.
          {targetPublished
            ? " The public Library listing stays available, with its published version and originating developer."
            : ""}
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
      <dialog
        ref={submitRef}
        aria-labelledby="submit-sdk-title"
        className="w-[min(460px,calc(100%-32px))] rounded-[14px] border border-solid border-border bg-card p-5 text-foreground backdrop:bg-[#00000080]"
        onClose={() => {
          if (!submitting) setSubmitTarget(null);
        }}
      >
        <h3 id="submit-sdk-title" className="text-[18px]">
          Submit {submitTarget?.name ?? "this SDK"}?
        </h3>
        <p className="mt-3 text-[14px] leading-[1.6] text-muted-foreground">
          {submitTarget?.description}
        </p>
        <p className="mt-3 text-[14px] leading-[1.6] text-muted-foreground">
          This sends the saved, tested revision to the operator for review. It
          does not launch a token. If it is approved, this exact revision
          becomes public and remixable.
        </p>
        <p className="mt-3 text-[14px] leading-[1.6] text-muted-foreground">
          {submitTarget?.submitterIsOriginator
            ? "You are recorded as the originating developer."
            : `The originating developer stays ${submitTarget?.originatorLabel ?? "the original developer"}. Submission does not change that credit.`}
        </p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            autoFocus
            disabled={submitting}
            onClick={() => setSubmitTarget(null)}
            className="rounded-lg border border-solid border-border bg-background px-3 py-2 font-mono text-[10px] tracking-[0.04em] uppercase disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void confirmSubmit()}
            className="rounded-lg border border-solid border-accent bg-accent px-3 py-2 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase disabled:opacity-60"
          >
            {submitting ? "Submitting" : "Confirm submission"}
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

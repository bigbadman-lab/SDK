"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type KeyRecord = {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

type KeyList = {
  active: number;
  limit: number;
  usedToday: number;
  remaining: number;
  keys: KeyRecord[];
};

type CreatedKey = KeyRecord & { secret: string };

export function ApiKeys(): ReactNode {
  const [list, setList] = useState<KeyList | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const response = await fetch("/api/account/api-keys", { credentials: "same-origin", cache: "no-store" });
      const body = (await response.json()) as KeyList & { error?: { message?: string } };
      if (!active) return;
      if (!response.ok) {
        setNotice(body.error?.message ?? "API keys are unavailable.");
        return;
      }
      setList(body);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (created && !dialog.open) dialog.showModal();
    if (!created && dialog.open) dialog.close();
  }, [created]);

  async function create(path: string, nextLabel: string): Promise<void> {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: nextLabel }),
      });
      const body = (await response.json()) as { key?: CreatedKey; error?: { message?: string } };
      if (!response.ok || !body.key?.secret) {
        setNotice(body.error?.message ?? "The API key could not be created.");
        return;
      }
      setCreated(body.key);
      setCopied(false);
      setLabel("");
      const refreshed = await fetch("/api/account/api-keys", { credentials: "same-origin", cache: "no-store" });
      if (refreshed.ok) setList((await refreshed.json()) as KeyList);
    } catch {
      setNotice("The API key could not be created.");
    } finally {
      setPending(false);
    }
  }

  async function revoke(keyId: string): Promise<void> {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/account/api-keys/${keyId}/revoke`, {
        method: "POST",
        credentials: "same-origin",
      });
      const body = (await response.json()) as { error?: { message?: string } };
      if (!response.ok) {
        setNotice(body.error?.message ?? "The API key could not be revoked.");
        return;
      }
      setList((current) =>
        current
          ? { ...current, active: Math.max(0, current.active - 1), keys: current.keys.filter((key) => key.id !== keyId) }
          : current,
      );
    } catch {
      setNotice("The API key could not be revoked.");
    } finally {
      setPending(false);
    }
  }

  const full = list !== null && list.active >= list.limit;

  return (
    <section className="grid gap-3 border-t border-t-border pt-8" aria-labelledby="api-keys-title">
      <h2 id="api-keys-title" className="font-mono text-[11px] tracking-[0.08em] uppercase">
        API keys
      </h2>
      <p className="max-w-130 text-[15px] leading-[1.7] text-muted-foreground">
        A key calls published SDKs. It cannot sign for this wallet, publish an SDK, or move funds. The secret is shown
        once, when the key is created.
      </p>
      {list === null && !notice ? (
        <div aria-busy="true">
          <p className="sr-only">Loading API keys</p>
          <span className="block h-10 motion-safe:animate-pulse bg-muted" />
        </div>
      ) : null}
      {list ? (
        <p className="font-mono text-[10px] text-muted-foreground uppercase">
          {list.active} of {list.limit} active · {list.usedToday} of 100 API executions today · {list.remaining} remaining
        </p>
      ) : null}
      {notice ? <p className="font-mono text-[11px] text-muted-foreground">{notice}</p> : null}
      {list ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void create("/api/account/api-keys", label);
          }}
        >
          <label className="sr-only" htmlFor="api-key-label">
            Key label
          </label>
          <input
            id="api-key-label"
            value={label}
            maxLength={80}
            placeholder="Label"
            onChange={(event) => setLabel(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-solid border-border bg-card px-3 py-2 text-[14px]"
          />
          <button
            type="submit"
            disabled={pending || full || label.trim().length < 1}
            className="rounded-lg border border-solid border-accent bg-accent px-3 py-2 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase disabled:opacity-60"
          >
            {pending ? "Working" : "Create key"}
          </button>
        </form>
      ) : null}
      {full ? (
        <p className="text-[13px] leading-[1.5] text-muted-foreground">
          Revoke a key before creating another. Five active keys is the account limit.
        </p>
      ) : null}
      {list && list.keys.length > 0 ? (
        <ul className="grid gap-4">
          {list.keys.map((key) => (
            <li key={key.id} className="grid gap-2 border-t border-t-border pt-4">
              <span className="text-[15px]">{key.label}</span>
              <span className="font-mono text-[12px] text-muted-foreground">{key.prefix}…</span>
              <span className="font-mono text-[10px] text-muted-foreground uppercase">
                Created {formatStamp(key.createdAt)} · Last used {key.lastUsedAt ? formatStamp(key.lastUsedAt) : "Never"}
              </span>
              <span className="flex flex-wrap gap-4 font-mono text-[10px] tracking-[0.04em] uppercase">
                <button type="button" className="underline" disabled={pending} onClick={() => void revoke(key.id)}>
                  Revoke
                </button>
                <button
                  type="button"
                  className="underline"
                  disabled={pending}
                  onClick={() => void create(`/api/account/api-keys/${key.id}/replace`, key.label)}
                >
                  Replace
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <dialog
        ref={dialogRef}
        aria-labelledby="api-key-secret-title"
        className="w-[min(460px,calc(100%-32px))] rounded-[14px] border border-solid border-border bg-card p-5 text-foreground backdrop:bg-[#00000080]"
        onClose={() => {
          setCreated(null);
          setCopied(false);
        }}
      >
        <h3 id="api-key-secret-title" className="text-[18px]">
          Copy {created?.label ?? "this key"}
        </h3>
        <p className="mt-3 text-[14px] leading-[1.6] text-muted-foreground">
          This is the only time the secret is shown. Store it in a server environment variable. It will not appear in
          this account again.
        </p>
        <p className="mt-3 font-mono text-[12px] break-all">{created?.secret}</p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => {
              if (!created) return;
              void navigator.clipboard.writeText(created.secret).then(() => setCopied(true));
            }}
            className="rounded-lg border border-solid border-accent bg-accent px-3 py-2 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase"
          >
            {copied ? "Copied" : "Copy key"}
          </button>
          <button
            type="button"
            onClick={() => setCreated(null)}
            className="rounded-lg border border-solid border-border bg-background px-3 py-2 font-mono text-[10px] tracking-[0.04em] uppercase"
          >
            Done
          </button>
        </div>
      </dialog>
    </section>
  );
}

function formatStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

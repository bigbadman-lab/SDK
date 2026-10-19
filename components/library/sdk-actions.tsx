"use client";

import { WalletButton } from "@/components/wallet/wallet-button";
import type { LibraryInput } from "@/lib/library/library";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

type Trace = { stepId: string; status: string; durationMs: number; errorCode?: string };
type Run = {
  executionId: string;
  status: string;
  durationMs: number;
  errorCode: string | null;
  output: unknown;
  traces: Trace[];
};

type LibraryField = LibraryInput & { help?: string; example?: string };

export function LibraryActions({
  sdkId,
  versionId,
  inputs,
}: {
  sdkId: string;
  versionId: string;
  inputs: LibraryField[];
}): ReactNode {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<"test" | "remix" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);

  async function testSdk(): Promise<void> {
    if (pending) return;
    setPending("test");
    setNotice(null);
    setRun(null);
    try {
      const response = await fetch(`/api/library/${sdkId}/test`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          versionId,
          inputs: payload(inputs, values),
        }),
      });
      const body = (await response.json()) as Run & { error?: string };
      if (response.status === 401) {
        setNotice("Sign in to test this SDK.");
        return;
      }
      if (!response.ok) {
        setNotice(body.error ?? "The test did not run.");
        return;
      }
      setRun(body);
    } catch {
      setNotice("The test did not run.");
    } finally {
      setPending(null);
    }
  }

  async function remixSdk(): Promise<void> {
    if (pending) return;
    setPending("remix");
    setNotice(null);
    try {
      const response = await fetch(`/api/library/${sdkId}/remix`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const body = (await response.json()) as { draftId?: string; error?: string };
      if (response.status === 401) {
        setNotice("Sign in to remix this SDK.");
        return;
      }
      if (!response.ok || !body.draftId) {
        setNotice(body.error ?? "The remix could not be opened.");
        return;
      }
      router.push(`/build?draft=${encodeURIComponent(body.draftId)}`);
    } catch {
      setNotice("The remix could not be opened.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid gap-6">
      <section id="test" className="grid gap-3 border-t border-t-border pt-6">
        <h2 className="text-[20px]">Test this SDK</h2>
        <p className="max-w-130 text-[14px] leading-[1.6] text-muted-foreground">
          A signed-in wallet runs this published version on the shared engine. The result is for this test only. A test is not a launch.
        </p>
        {inputs.some((field) => field.example !== undefined) ? (
          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => {
                const next: Record<string, string> = {};
                for (const field of inputs) {
                  if (field.example !== undefined) next[field.key] = field.example;
                }
                setValues(next);
                setRun(null);
                setNotice(null);
              }}
              className="justify-self-start rounded-lg border border-solid border-border bg-background px-3 py-2 font-mono text-[10px] tracking-[0.04em] uppercase"
            >
              Fill example inputs
            </button>
            <p className="text-[13px] leading-[1.6] text-muted-foreground">
              Examples fill the form. They are not a test result.
            </p>
          </div>
        ) : null}
        {inputs.map((field) => (
          <label key={field.key} className="grid gap-1 font-mono text-[10px] text-muted-foreground uppercase">
            {field.key}
            {field.required ? " · required" : ""}
            {field.help ? (
              <span className="font-sans text-[13px] leading-[1.5] text-muted-foreground normal-case">{field.help}</span>
            ) : null}
            {field.type === "boolean" ? (
              <select
                value={values[field.key] ?? "false"}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                className="rounded-lg border border-solid border-border bg-background px-3 py-2 text-[14px] text-foreground normal-case"
              >
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            ) : field.type === "enum" ? (
              <select
                value={values[field.key] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                className="rounded-lg border border-solid border-border bg-background px-3 py-2 text-[14px] text-foreground normal-case"
              >
                <option value="">Choose</option>
                {field.values.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            ) : field.type === "string" ? (
              <textarea
                value={values[field.key] ?? ""}
                rows={3}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                className="rounded-lg border border-solid border-border bg-background px-3 py-2 font-sans text-[14px] text-foreground normal-case"
              />
            ) : (
              <input
                value={values[field.key] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                className="rounded-lg border border-solid border-border bg-background px-3 py-2 font-sans text-[14px] text-foreground normal-case"
              />
            )}
          </label>
        ))}
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => void testSdk()}
          className="justify-self-start rounded-lg border border-solid border-border bg-background px-3 py-2 font-mono text-[10px] tracking-[0.04em] uppercase disabled:opacity-60"
        >
          {pending === "test" ? "Testing" : "Test SDK"}
        </button>
      </section>
      <section id="remix" className="grid gap-3 border-t border-t-border pt-6">
        <h2 className="text-[20px]">Remix this SDK</h2>
        <p className="max-w-130 text-[14px] leading-[1.6] text-muted-foreground">
          Remix opens a private unsaved copy in the Builder. The published SDK stays unchanged, and the copy is not listed until a later review.
        </p>
        <button
          type="button"
          disabled={pending !== null}
          onClick={() => void remixSdk()}
          className="justify-self-start rounded-lg border border-solid border-accent bg-accent px-3 py-2 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase disabled:opacity-60"
        >
          {pending === "remix" ? "Opening" : "Remix SDK"}
        </button>
      </section>
      {notice ? (
        <p className="font-mono text-[11px] text-muted-foreground uppercase" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {notice ? <WalletButton compact /> : null}
      {run ? (
        <div className="grid gap-2">
          <p className={"font-mono text-[10px] uppercase " + (run.status === "SUCCESS" ? "text-accent-ink" : "text-muted-foreground")}>
            {run.status === "SUCCESS" ? "Test passed" : "Test failed"} · {run.status} · {run.executionId} · {run.durationMs}ms
          </p>
          {run.errorCode ? <p className="text-[13px] break-words text-muted-foreground">{run.errorCode}</p> : null}
          <ul className="grid gap-1">
            {run.traces.map((trace) => (
              <li key={trace.stepId} className="font-mono text-[10px] break-words text-muted-foreground">
                {trace.stepId} {trace.status} {trace.durationMs}ms {trace.errorCode ?? ""}
              </li>
            ))}
          </ul>
          <pre className="overflow-auto font-mono text-[10px] leading-[1.5] break-words whitespace-pre-wrap text-foreground">
            {JSON.stringify(run.output, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function payload(inputs: LibraryInput[], values: Record<string, string>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const field of inputs) {
    const raw = values[field.key] ?? "";
    if (field.type === "number") next[field.key] = Number(raw);
    else if (field.type === "boolean") next[field.key] = raw === "true";
    else next[field.key] = raw;
  }
  return next;
}

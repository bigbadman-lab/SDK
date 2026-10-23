"use client";

import { WalletButton } from "@/components/wallet/wallet-button";
import type { PublishedTokenSdk } from "@/lib/launch/verified-launch";
import { useState, type ReactNode } from "react";

type Field = PublishedTokenSdk["inputs"][number];
type Trace = { stepId: string; status: string; durationMs: number; errorCode?: string };
type Run = {
  executionId: string;
  status: string;
  durationMs: number;
  errorCode: string | null;
  output: unknown;
  traces: Trace[];
};

export function TokenSdkTest({ sdk }: { sdk: PublishedTokenSdk }): ReactNode {
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const examples = sdk.inputs.some((field) => field.example !== undefined);

  async function runSdk(): Promise<void> {
    if (pending) return;
    setPending(true);
    setNotice(null);
    setRun(null);
    try {
      const response = await fetch(`/api/library/${sdk.id}/test`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId: sdk.versionId, inputs: payload(sdk.inputs, values) }),
      });
      const body = (await response.json()) as Run & { error?: string };
      if (response.status === 401) {
        setNotice("Sign in to test this SDK.");
        return;
      }
      if (!response.ok || typeof body.status !== "string") {
        setNotice(body.error ?? "The test did not run.");
        return;
      }
      setRun(body);
    } catch {
      setNotice("The test did not run.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="border border-border bg-card px-4 py-4">
      <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">Test {sdk.name}</p>
      <p className="mt-2 max-w-2xl text-[13px] leading-[1.55] text-muted-foreground">
        Run version {sdk.versionNumber} here. A signed-in wallet uses the shared engine. The result stays on this page, and a test does not launch a token.
      </p>
      {examples ? (
        <button
          type="button"
          className="mt-3 font-mono text-[10px] tracking-[0.04em] uppercase hover:text-accent-ink"
          onClick={() => {
            const next: Record<string, string> = {};
            for (const field of sdk.inputs) {
              if (field.example !== undefined) next[field.key] = field.example;
            }
            setValues(next);
            setRun(null);
            setNotice(null);
          }}
        >
          Fill example
        </button>
      ) : null}
      <div className="mt-4 grid gap-3">
        {sdk.inputs.map((field) => (
          <label key={field.key} className="grid gap-1">
            <span className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground uppercase">
              {field.key}
              {field.required ? " · required" : ""}
              {field.type === "string" || field.type === "enum" || field.type === "boolean" ? "" : ` · ${field.type}`}
            </span>
            {field.help ? <span className="text-[13px] leading-[1.45] text-muted-foreground">{field.help}</span> : null}
            <FieldControl
              field={field}
              value={values[field.key] ?? (field.type === "boolean" ? "false" : "")}
              onChange={(next) => setValues((current) => ({ ...current, [field.key]: next }))}
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        disabled={pending}
        onClick={() => void runSdk()}
        className="mt-4 rounded-lg border border-solid border-accent bg-accent px-3 py-2 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase disabled:opacity-60"
      >
        {pending ? "Running" : "Run SDK"}
      </button>
      {notice ? (
        <p className="mt-3 font-mono text-[11px] text-muted-foreground uppercase" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {notice === "Sign in to test this SDK." ? (
        <div className="mt-3">
          <WalletButton compact />
        </div>
      ) : null}
      {run ? <RunResult run={run} /> : null}
    </section>
  );
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  const control = "rounded-lg border border-solid border-border bg-background px-3 py-2 text-[14px] text-foreground";
  if (field.type === "boolean") {
    return (
      <select className={control} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="false">false</option>
        <option value="true">true</option>
      </select>
    );
  }
  if (field.type === "enum") {
    return (
      <select className={control} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose</option>
        {field.values.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "string") {
    return (
      <textarea className={control} rows={3} value={value} onChange={(event) => onChange(event.target.value)} />
    );
  }
  return (
    <input
      className={control + (field.type === "solanaAddress" ? " font-mono text-[12px]" : "")}
      value={value}
      spellCheck={field.type === "solanaAddress" ? false : undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function RunResult({ run }: { run: Run }): ReactNode {
  return (
    <div className="mt-4 grid gap-2 border-t border-border pt-3">
      <p className={"font-mono text-[10px] tracking-[0.04em] uppercase " + (run.status === "SUCCESS" ? "text-accent-ink" : "text-muted-foreground")}>
        {run.status === "SUCCESS" ? "Test passed" : "Test failed"} · {run.status} · {run.durationMs}ms
      </p>
      {run.errorCode ? <p className="text-[13px] break-words text-muted-foreground">{run.errorCode}</p> : null}
      <pre className="max-h-80 overflow-auto border border-border bg-background p-3 font-mono text-[11px] leading-[1.55] break-words whitespace-pre-wrap">
        {JSON.stringify(run.output, null, 2)}
      </pre>
      {run.traces.length > 0 ? (
        <details className="font-mono text-[10px] text-muted-foreground">
          <summary className="cursor-pointer tracking-[0.04em] uppercase">Steps</summary>
          <ul className="mt-2 grid gap-1">
            {run.traces.map((trace) => (
              <li key={trace.stepId}>
                {trace.stepId} {trace.status} {trace.durationMs}ms {trace.errorCode ?? ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function payload(inputs: readonly Field[], values: Record<string, string>): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const field of inputs) {
    const raw = values[field.key] ?? (field.type === "boolean" ? "false" : "");
    if (field.type === "number") next[field.key] = Number(raw);
    else if (field.type === "boolean") next[field.key] = raw === "true";
    else next[field.key] = raw;
  }
  return next;
}

"use client";

import { WalletButton } from "@/components/wallet/wallet-button";
import { useEffect, useState, type ReactNode } from "react";

type Session = { authenticated: boolean };
type BlueprintView = {
  name?: string;
  description?: string;
  inputs?: Record<string, { type?: string; required?: boolean; values?: string[] }>;
  steps?: Array<{ id?: string; op?: string }>;
};
type Message = { role: string; content: string; failed?: boolean };
type RunView = {
  executionId: string;
  status: string;
  durationMs: number;
  errorCode: string | null;
  output: unknown;
  traces: Array<{ stepId: string; status: string; durationMs: number; errorCode?: string }>;
};

export function BuilderPanel(): ReactNode {
  const [session, setSession] = useState<Session | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [revision, setRevision] = useState(1);
  const [blueprint, setBlueprint] = useState<BlueprintView | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<"message" | "test" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [run, setRun] = useState<RunView | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const response = await fetch("/api/auth/session", { credentials: "same-origin" });
      const body = (await response.json()) as { authenticated?: boolean };
      if (!active) return;
      const authenticated = body.authenticated === true;
      setSession({ authenticated });
      if (!authenticated) return;
      const id = new URLSearchParams(window.location.search).get("draft");
      if (id) await loadDraft(id, setDraftId, setRevision, setBlueprint, setMessages, setNotice);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function submitMessage(): Promise<void> {
    setPending("message");
    setNotice(null);
    try {
      const response = await fetch("/api/builder/messages", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: text,
          ...(draftId ? { draftId, revision } : {}),
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        draftId?: string;
        revision?: number;
        reply?: string;
        blueprint?: BlueprintView;
      };
      if (!response.ok || !body.draftId || !body.blueprint) {
        setNotice(body.error ?? "The blueprint request was not accepted.");
        return;
      }
      setDraftId(body.draftId);
      setRevision(body.revision ?? revision);
      setBlueprint(body.blueprint);
      setMessages((current) => [
        ...current,
        { role: "user", content: text },
        { role: "assistant", content: body.reply ?? "The draft was updated." },
      ]);
      setText("");
      const url = new URL(window.location.href);
      url.searchParams.set("draft", body.draftId);
      url.hash = "builder";
      window.history.replaceState(null, "", url);
    } finally {
      setPending(null);
    }
  }

  async function submitTest(): Promise<void> {
    if (!draftId) return;
    setPending("test");
    setNotice(null);
    setRun(null);
    const payload: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(blueprint?.inputs ?? {})) {
      const raw = inputs[key] ?? "";
      if (field.type === "number") payload[key] = Number(raw);
      else if (field.type === "boolean") payload[key] = raw === "true";
      else payload[key] = raw;
    }
    try {
      const response = await fetch(`/api/builder/drafts/${draftId}/test`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inputs: payload }),
      });
      const body = (await response.json()) as RunView & { error?: string };
      if (!response.ok) {
        setNotice(body.error ?? "The test did not run.");
        return;
      }
      setRun(body);
    } finally {
      setPending(null);
    }
  }

  if (!session?.authenticated) {
    return (
      <div className="grid gap-3">
        <p className="font-mono text-[10px] tracking-[0.08em] text-accent-ink uppercase">
          Builder
        </p>
        <p className="text-[15px] leading-[1.6] text-muted-foreground">
          Sign in with your wallet to describe a private SDK. A draft can be
          tested here. It is not launched or published.
        </p>
        <WalletButton compact />
      </div>
    );
  }

  return (
    <div className="grid max-h-[calc(100%-8px)] gap-3 overflow-auto">
      <p className="font-mono text-[10px] tracking-[0.08em] text-accent-ink uppercase">
        Private draft
      </p>
      <div className="grid max-h-28 gap-2 overflow-auto">
        {messages.length === 0 ? (
          <p className="text-[14px] leading-[1.6] text-muted-foreground">
            Describe the SDK you want. The reply becomes a validated Blueprint.
          </p>
        ) : (
          messages.map((message, index) => (
            <p key={`${message.role}-${index}`} className="text-[14px] leading-[1.5]">
              <span className="font-mono text-[10px] text-muted-foreground uppercase">
                {message.role}
              </span>{" "}
              {message.content}
            </p>
          ))
        )}
      </div>
      <label className="grid gap-1 font-mono text-[10px] text-muted-foreground uppercase">
        Request
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          className="resize-none rounded-lg border border-solid border-border bg-background px-3 py-2 font-sans text-[14px] text-foreground normal-case"
        />
      </label>
      <button
        type="button"
        disabled={pending !== null || text.trim().length === 0}
        onClick={() => void submitMessage()}
        className="justify-self-start rounded-lg border border-solid border-accent bg-accent px-3 py-2 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase disabled:opacity-60"
      >
        {pending === "message" ? "Working" : "Send"}
      </button>
      {blueprint ? (
        <div className="grid gap-2 border-t border-t-border pt-3">
          <p className="text-[15px]">{blueprint.name}</p>
          <p className="text-[13px] leading-[1.5] text-muted-foreground">{blueprint.description}</p>
          <ol className="grid gap-1">
            {(blueprint.steps ?? []).map((step) => (
              <li key={step.id} className="font-mono text-[10px] text-muted-foreground uppercase">
                {step.id} · {step.op}
              </li>
            ))}
          </ol>
          <p className="font-mono text-[10px] text-accent-ink uppercase">Valid draft. Not launched.</p>
          {Object.entries(blueprint.inputs ?? {}).map(([key, field]) => (
            <label key={key} className="grid gap-1 font-mono text-[10px] text-muted-foreground uppercase">
              {key}
              {field.type === "boolean" ? (
                <select
                  value={inputs[key] ?? "false"}
                  onChange={(event) => setInputs((current) => ({ ...current, [key]: event.target.value }))}
                  className="rounded-lg border border-solid border-border bg-background px-3 py-2 text-[14px] text-foreground normal-case"
                >
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              ) : field.type === "enum" ? (
                <select
                  value={inputs[key] ?? ""}
                  onChange={(event) => setInputs((current) => ({ ...current, [key]: event.target.value }))}
                  className="rounded-lg border border-solid border-border bg-background px-3 py-2 text-[14px] text-foreground normal-case"
                >
                  <option value="">Choose</option>
                  {(field.values ?? []).map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={inputs[key] ?? ""}
                  onChange={(event) => setInputs((current) => ({ ...current, [key]: event.target.value }))}
                  className="rounded-lg border border-solid border-border bg-background px-3 py-2 font-sans text-[14px] text-foreground normal-case"
                />
              )}
            </label>
          ))}
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void submitTest()}
            className="justify-self-start rounded-lg border border-solid border-border bg-card px-3 py-2 font-mono text-[10px] tracking-[0.04em] uppercase disabled:opacity-60"
          >
            {pending === "test" ? "Running" : "Test SDK"}
          </button>
        </div>
      ) : null}
      {notice ? <p className="font-mono text-[10px] text-muted-foreground">{notice}</p> : null}
      {run ? (
        <div className="grid gap-2">
          <p className="font-mono text-[10px] text-muted-foreground uppercase">
            {run.status} · {run.executionId} · {run.durationMs}ms
          </p>
          {run.errorCode ? <p className="text-[13px] text-muted-foreground">{run.errorCode}</p> : null}
          <ul className="grid gap-1">
            {run.traces.map((trace) => (
              <li key={trace.stepId} className="font-mono text-[10px] text-muted-foreground">
                {trace.stepId} {trace.status} {trace.durationMs}ms {trace.errorCode ?? ""}
              </li>
            ))}
          </ul>
          <pre className="overflow-auto font-mono text-[10px] leading-[1.5] whitespace-pre-wrap text-foreground">
            {JSON.stringify(run.output, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

async function loadDraft(
  id: string,
  setDraftId: (value: string) => void,
  setRevision: (value: number) => void,
  setBlueprint: (value: BlueprintView) => void,
  setMessages: (value: Message[]) => void,
  setNotice: (value: string | null) => void,
): Promise<void> {
  const response = await fetch(`/api/builder/drafts/${id}`, { credentials: "same-origin" });
  const body = (await response.json()) as {
    error?: string;
    revision?: number;
    blueprint?: BlueprintView;
    messages?: Message[];
  };
  if (!response.ok || !body.blueprint) {
    setNotice(body.error ?? "That draft is not available.");
    return;
  }
  setDraftId(id);
  setRevision(body.revision ?? 1);
  setBlueprint(body.blueprint);
  setMessages(body.messages ?? []);
}

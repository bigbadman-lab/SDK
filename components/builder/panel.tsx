"use client";

import { WalletButton } from "@/components/wallet/wallet-button";
import { loadBrowserSession, noteSignedOut, subscribeBrowserSession } from "@/lib/auth/browser-session";
import { beginGeneration, emitBuildStage, settleGeneration, subscribeBuildStage } from "@/lib/builder/handoff";
import { accountDestination, shouldRedirectAfterSave } from "@/lib/blueprint/save";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

type Session = { authenticated: boolean };
type BlueprintView = {
  name?: string;
  description?: string;
  inputs?: Record<string, { type?: string; required?: boolean; values?: string[] }>;
  steps?: Array<{ id?: string; op?: string }>;
  outputs?: Record<string, { type?: string; from?: { $ref?: string } }>;
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
type Stage = "understanding" | "constructing" | "validating" | "ready";
type BuilderEvent = {
  stage?: Stage;
  error?: string;
  draftId?: string;
  blueprint?: BlueprintView;
  revision?: number;
  reply?: string;
  saved?: boolean;
  unauthenticated?: boolean;
};

const STAGE_LABEL: Record<Stage, string> = {
  understanding: "Understanding your request",
  constructing: "Constructing SDK Blueprint",
  validating: "Validating operations",
  ready: "SDK ready for testing",
};

export function BuilderPanel(): ReactNode {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [revision, setRevision] = useState(1);
  const [blueprint, setBlueprint] = useState<BlueprintView | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<"message" | "test" | "save" | null>(null);
  const [stage, setStage] = useState<Stage | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [tested, setTested] = useState(false);
  const [naming, setNaming] = useState(false);
  const [sdkName, setSdkName] = useState("");
  const [sdkDescription, setSdkDescription] = useState("");
  const [savedName, setSavedName] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pane, setPane] = useState<"conversation" | "sdk">("conversation");
  const busy = useRef(false);
  const draftIdRef = useRef<string | null>(null);
  const revisionRef = useRef(1);
  draftIdRef.current = draftId;
  revisionRef.current = revision;

  useEffect(() => subscribeBuildStage((next) => setStage(next)), []);

  useEffect(() => {
    if (pending === null) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pending]);

  useEffect(() => {
    return subscribeBrowserSession((next) => {
      if (next.status === "unknown") return;
      setSession({ authenticated: next.status === "signed-in" });
    });
  }, []);

  useEffect(() => {
    void loadBrowserSession();
  }, []);

  const signedIn = session?.authenticated === true;

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const id = params.get("draft");
      if (id) {
        const loaded = await loadDraft(id);
        if (cancelled) return;
        if (!loaded) {
          setNotice("That draft is not available.");
          return;
        }
        applyDraft(loaded, setDraftId, setRevision, setBlueprint, setMessages, setRun, setTested, setSavedName, setDirty);
        if (params.get("intent") === "test") {
          setPane("sdk");
          document.getElementById("sdk-test")?.scrollIntoView({ block: "nearest" });
        }
        return;
      }
      const job = beginGeneration(window.sessionStorage, (prompt) => postMessage(prompt));
      if (!job || cancelled) return;
      setMessages([{ role: "user", content: job.prompt }]);
      setPending("message");
      setStage("understanding");
      setElapsed(0);
      busy.current = true;
      try {
        const ready = await job.promise;
        if (cancelled) return;
        applyGeneration(ready, job.prompt, true);
      } catch {
        if (!cancelled) {
          setStage(null);
          setNotice("The blueprint request was not accepted.");
        }
      } finally {
        if (!cancelled) {
          busy.current = false;
          setPending(null);
          settleGeneration(job.id);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  function applyGeneration(ready: BuilderEvent | null, userText: string, alreadyListed: boolean): void {
    if (ready?.unauthenticated) {
      noteSignedOut();
      setStage(null);
      setNotice("Sign in to build an SDK.");
      return;
    }
    if (!ready || ready.error || !ready.draftId || !ready.blueprint) {
      setStage(null);
      setNotice(ready?.error ?? "The blueprint request was not accepted.");
      return;
    }
    draftIdRef.current = ready.draftId;
    revisionRef.current = ready.revision ?? revisionRef.current;
    setDraftId(ready.draftId);
    setRevision(revisionRef.current);
    setBlueprint(ready.blueprint);
    setMessages((current) => [
      ...(alreadyListed ? current : [...current, { role: "user", content: userText }]),
      { role: "assistant", content: ready.reply ?? "The blueprint is ready to test." },
    ]);
    setText("");
    setRun(null);
    setTested(false);
    setNaming(false);
    setDirty(ready.saved === true);
    if (ready.saved !== true) setSavedName(null);
    setStage("ready");
    const url = new URL(window.location.href);
    url.searchParams.set("draft", ready.draftId);
    url.hash = "";
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }

  async function submitMessage(): Promise<void> {
    const message = text.trim();
    if (busy.current || message.length === 0) return;
    if (blueprint && !draftIdRef.current) {
      setNotice("This request is not attached to the current SDK.");
      return;
    }
    busy.current = true;
    setPending("message");
    setStage("understanding");
    setElapsed(0);
    setNotice(null);
    try {
      const ready = await postMessage(message, draftIdRef.current ? { draftId: draftIdRef.current, revision: revisionRef.current } : undefined);
      applyGeneration(ready, message, false);
    } catch {
      setStage(null);
      setNotice("The blueprint request was not accepted.");
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  async function submitTest(): Promise<void> {
    if (busy.current || !draftId) return;
    busy.current = true;
    setPending("test");
    setStage(null);
    setElapsed(0);
    setNotice(null);
    setRun(null);
    setTested(false);
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
      if (response.status === 401) {
        noteSignedOut();
        setNotice("Sign in to build an SDK.");
        return;
      }
      if (!response.ok) {
        setNotice(body.error ?? "The test did not run.");
        return;
      }
      setRun(body);
      setTested(body.status === "SUCCESS");
      if (body.status === "SUCCESS") {
        setSdkName(blueprint?.name ?? "");
        setSdkDescription(blueprint?.description ?? "");
      }
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  async function submitSave(): Promise<void> {
    if (busy.current || !draftId || !tested) return;
    busy.current = true;
    setPending("save");
    setNotice(null);
    try {
      const response = await fetch(`/api/builder/drafts/${draftId}/save`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: sdkName, description: sdkDescription }),
      });
      const body = (await response.json()) as {
        error?: string;
        name?: string;
        draftId?: string;
        saved?: boolean;
      };
      if (response.status === 401) {
        noteSignedOut();
        setNotice("Sign in to build an SDK.");
        return;
      }
      if (
        !shouldRedirectAfterSave({
          ok: response.ok,
          ...(typeof body.saved === "boolean" ? { saved: body.saved } : {}),
          ...(body.draftId ? { draftId: body.draftId } : {}),
        }) ||
        !body.draftId
      ) {
        setNotice(body.error ?? "The draft could not be saved.");
        return;
      }
      setSavedName(body.name ?? sdkName);
      setDirty(false);
      setNaming(false);
      router.push(accountDestination(body.draftId));
    } finally {
      busy.current = false;
      setPending(null);
    }
  }

  if (!session) {
    return <p className="font-mono text-[10px] tracking-[0.08em] text-accent-ink uppercase">Builder</p>;
  }

  if (!session.authenticated) {
    return (
      <div className="grid content-start gap-3">
        <p className="font-mono text-[10px] tracking-[0.08em] text-accent-ink uppercase">Builder</p>
        <p className="max-w-130 text-[15px] leading-[1.6] text-muted-foreground">
          Sign in to build an SDK. A connected wallet is not a signed-in session until the server verifies it.
        </p>
        <WalletButton compact />
      </div>
    );
  }

  const conversationHidden = pane === "sdk" ? "max-[800px]:hidden" : "";
  const workspaceHidden = pane === "conversation" ? "max-[800px]:hidden" : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex gap-2 min-[801px]:hidden">
        <PaneButton current={pane} name="conversation" onSelect={setPane}>Conversation</PaneButton>
        <PaneButton current={pane} name="sdk" onSelect={setPane}>SDK</PaneButton>
      </div>
      {notice ? <p className="font-mono text-[11px] text-muted-foreground" aria-live="polite">{notice}</p> : null}
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 max-[800px]:grid-cols-1">
        <section className={`flex min-h-0 min-w-0 flex-col gap-3 overflow-auto border border-solid border-border bg-card p-5 ${conversationHidden}`}>
          <p className="font-mono text-[10px] tracking-[0.08em] text-accent-ink uppercase">
            {savedName ? "Saved SDK" : "Unsaved workspace"}
          </p>
          <div className="grid min-h-24 gap-2">
            {messages.length === 0 ? (
              <p className="text-[14px] leading-[1.6] text-muted-foreground">
                Describe the SDK you want. Nothing is added to My SDKs until you test it and save a name.
              </p>
            ) : (
              messages.map((message, index) => (
                <p key={`${message.role}-${index}`} className="text-[14px] leading-[1.5] break-words">
                  <span className="font-mono text-[10px] text-muted-foreground uppercase">{message.role}</span>{" "}
                  {message.content}
                </p>
              ))
            )}
          </div>
          {pending === "message" && stage ? (
            <p className="font-mono text-[10px] text-accent-ink uppercase" aria-live="polite">
              <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse" />
              {STAGE_LABEL[stage]} · {elapsed}s
            </p>
          ) : null}
          {stage === "ready" && pending === null && blueprint ? (
            <p className="font-mono text-[10px] text-accent-ink uppercase" aria-live="polite">{STAGE_LABEL.ready}</p>
          ) : null}
          <label className="mt-auto grid gap-1 font-mono text-[10px] text-muted-foreground uppercase">
            Request
            <textarea
              value={text}
              disabled={pending !== null}
              onChange={(event) => setText(event.target.value)}
              rows={4}
              className="resize-none rounded-lg border border-solid border-border bg-background px-3 py-2 font-sans text-[14px] text-foreground normal-case disabled:opacity-60"
            />
          </label>
          <button
            type="button"
            disabled={pending !== null || text.trim().length === 0}
            onClick={() => void submitMessage()}
            className="justify-self-start rounded-lg border border-solid border-accent bg-accent px-3 py-2 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase disabled:opacity-60"
          >
            {pending === "message" ? "Building" : "Send"}
          </button>
        </section>
        <section className={`flex min-h-0 min-w-0 flex-col gap-3 overflow-auto border border-solid border-border bg-card p-5 ${workspaceHidden}`}>
          {blueprint ? (
            <>
              <p className="text-[20px] leading-[1.3]">{blueprint.name}</p>
              <p className="text-[14px] leading-[1.6] text-muted-foreground">{blueprint.description}</p>
              <div className="grid gap-1">
                {Object.entries(blueprint.inputs ?? {}).map(([key, field]) => (
                  <p key={key} className="font-mono text-[10px] text-muted-foreground uppercase">
                    Input {key} · {field.type}
                    {field.required ? " · required" : ""}
                  </p>
                ))}
                {(blueprint.steps ?? []).map((step, index) => (
                  <p key={step.id ?? index} className="font-mono text-[10px] text-muted-foreground uppercase">
                    {index + 1}. {step.id} · {step.op}
                  </p>
                ))}
                {Object.entries(blueprint.outputs ?? {}).map(([key, output]) => (
                  <p key={key} className="font-mono text-[10px] text-muted-foreground uppercase">
                    Output {key} · {output.type} · {output.from?.$ref}
                  </p>
                ))}
              </div>
              <p className="font-mono text-[10px] text-accent-ink uppercase">
                Valid blueprint. {savedName ? `Saved as ${savedName}.` : "Not saved."}{" "}
                {dirty ? "This revision is not saved." : ""} Not launched.
              </p>
              <details className="font-mono text-[10px] text-muted-foreground">
                <summary className="cursor-pointer uppercase">Blueprint JSON</summary>
                <pre className="mt-2 overflow-auto leading-[1.5] break-words whitespace-pre-wrap text-foreground">
                  {JSON.stringify(blueprint, null, 2)}
                </pre>
              </details>
              <div id="sdk-test" className="grid gap-2 border-t border-t-border pt-3">
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
                  className="justify-self-start rounded-lg border border-solid border-border bg-background px-3 py-2 font-mono text-[10px] tracking-[0.04em] uppercase disabled:opacity-60"
                >
                  {pending === "test" ? `Testing · ${elapsed}s` : "Test SDK"}
                </button>
              </div>
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
              {tested ? (
                naming ? (
                  <form
                    className="grid gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitSave();
                    }}
                  >
                    <label className="grid gap-1 font-mono text-[10px] text-muted-foreground uppercase">
                      SDK name
                      <input
                        value={sdkName}
                        onChange={(event) => setSdkName(event.target.value)}
                        className="rounded-lg border border-solid border-border bg-background px-3 py-2 font-sans text-[14px] text-foreground normal-case"
                      />
                    </label>
                    <label className="grid gap-1 font-mono text-[10px] text-muted-foreground uppercase">
                      Description
                      <textarea
                        value={sdkDescription}
                        onChange={(event) => setSdkDescription(event.target.value)}
                        rows={2}
                        className="resize-none rounded-lg border border-solid border-border bg-background px-3 py-2 font-sans text-[14px] text-foreground normal-case"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={pending !== null}
                      className="justify-self-start rounded-lg border border-solid border-accent bg-accent px-3 py-2 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase disabled:opacity-60"
                    >
                      {pending === "save" ? "Saving" : "Confirm save"}
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => {
                      setSdkName(savedName || blueprint.name || "");
                      setSdkDescription(blueprint.description ?? "");
                      setNaming(true);
                    }}
                    className="justify-self-start rounded-lg border border-solid border-accent bg-accent px-3 py-2 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase disabled:opacity-60"
                  >
                    Save SDK
                  </button>
                )
              ) : (
                <p className="font-mono text-[10px] text-muted-foreground uppercase">Test this revision before saving.</p>
              )}
            </>
          ) : (
            <p className="text-[14px] leading-[1.6] text-muted-foreground">
              The SDK preview appears here after the blueprint is ready. A test is not a launch.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function PaneButton({
  current,
  name,
  onSelect,
  children,
}: {
  current: "conversation" | "sdk";
  name: "conversation" | "sdk";
  onSelect: (name: "conversation" | "sdk") => void;
  children: string;
}): ReactNode {
  const selected = current === name;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(name)}
      className={
        "rounded-lg border border-solid px-3 py-2 font-mono text-[10px] tracking-[0.04em] uppercase " +
        (selected ? "border-accent bg-accent text-accent-foreground" : "border-border bg-card")
      }
    >
      {children}
    </button>
  );
}

type DraftPayload = {
  error?: string;
  revision?: number;
  blueprint?: BlueprintView;
  messages?: Message[];
  tested?: boolean;
  savedName?: string | null;
  dirty?: boolean;
  run?: RunView | null;
};

async function loadDraft(id: string): Promise<DraftPayload | null> {
  const response = await fetch(`/api/builder/drafts/${id}`, { credentials: "same-origin" });
  const body = (await response.json()) as DraftPayload;
  if (!response.ok || !body.blueprint) return null;
  return body;
}

function applyDraft(
  body: DraftPayload,
  setDraftId: (value: string) => void,
  setRevision: (value: number) => void,
  setBlueprint: (value: BlueprintView) => void,
  setMessages: (value: Message[]) => void,
  setRun: (value: RunView | null) => void,
  setTested: (value: boolean) => void,
  setSavedName: (value: string | null) => void,
  setDirty: (value: boolean) => void,
): void {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("draft");
  if (!id || !body.blueprint) return;
  setDraftId(id);
  setRevision(body.revision ?? 1);
  setBlueprint(body.blueprint);
  setMessages(body.messages ?? []);
  setRun(body.run ?? null);
  setTested(body.tested === true);
  setSavedName(body.savedName ?? null);
  setDirty(body.dirty === true);
}

async function postMessage(
  message: string,
  draft?: { draftId: string; revision: number },
): Promise<BuilderEvent | null> {
  const response = await fetch("/api/builder/messages", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message,
      ...(draft ? { draftId: draft.draftId, revision: draft.revision } : {}),
    }),
  });
  if (response.status === 401) {
    return { error: "Sign in to build an SDK.", unauthenticated: true };
  }
  if (!response.ok) {
    const body = (await response.json()) as { error?: string };
    return { error: body.error ?? "The blueprint request was not accepted." };
  }
  return readEvents(response);
}

async function readEvents(response: Response): Promise<BuilderEvent | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let buffer = "";
  let ready: BuilderEvent | null = null;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as BuilderEvent;
      if (event.stage === "understanding" || event.stage === "constructing" || event.stage === "validating") {
        emitBuildStage(event.stage);
      }
      if (event.stage === "ready" || event.error) ready = event;
    }
  }
  return ready;
}

"use client";

import { WalletButton } from "@/components/wallet/wallet-button";
import { getBrowserSession, loadBrowserSession, subscribeBrowserSession } from "@/lib/auth/browser-session";
import { builderPath, createHandoff, homepageSend, storeHandoff } from "@/lib/builder/handoff";
import { ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const EXAMPLES = [
  "Build a Solana wallet intelligence tool",
  "Create an AI-powered token research assistant",
  "Build an on-chain transaction analyser",
] as const;

export function HomePrompt(): ReactNode {
  const router = useRouter();
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    return subscribeBrowserSession((next) => {
      if (next.status !== "signed-in") return;
      setNotice((current) => (current === "Sign in to build an SDK." ? null : current));
    });
  }, []);

  useEffect(() => {
    void loadBrowserSession();
  }, []);

  async function submit(): Promise<void> {
    if (submitting) return;
    setSubmitting(true);
    setNotice(null);
    try {
      let signedIn = getBrowserSession().status === "signed-in";
      if (!signedIn) {
        const latest = await loadBrowserSession();
        signedIn = latest.status === "signed-in";
      }
      const decision = homepageSend({ authenticated: signedIn, prompt: text });
      if (decision === "empty") return;
      if (decision === "sign_in") {
        setNotice("Sign in to build an SDK.");
        return;
      }
      const handoff = createHandoff(text);
      if (!handoff) {
        setNotice("Enter a request up to 8000 characters.");
        return;
      }
      storeHandoff(window.sessionStorage, handoff);
      router.push(builderPath());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="rounded-[14px] border border-solid border-[#ffffff1f] bg-[#1c1c1c] px-3.5 pt-3 pb-2.5 shadow-[0_8px_28px_#00000040]">
        <label className="sr-only" htmlFor="sdk-home-prompt">
          What do you want to build?
        </label>
        <textarea
          id="sdk-home-prompt"
          value={text}
          rows={2}
          placeholder="What do you want to build?"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          className="max-h-28 min-h-14 w-full resize-none bg-transparent px-1 py-1 font-sans text-[15px] leading-[1.5] text-[#f2f2f2] outline-none placeholder:text-[#8d8d8d]"
        />
        <div className="mt-1 flex items-center gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap gap-1">
            {EXAMPLES.map((example) => {
              const selected = text === example;
              return (
                <button
                  key={example}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setText(example)}
                  className={
                    "shrink-0 rounded-lg px-2.5 py-1.5 text-left text-[13px] " +
                    (selected ? "bg-[#3a3a3a] text-[#f5f5f5]" : "text-[#c6c6c6] hover:bg-[#2a2a2a]")
                  }
                >
                  {example}
                </button>
              );
            })}
          </div>
          <button
            type="submit"
            aria-label="Send"
            disabled={submitting || text.trim().length === 0}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#3a3a3a] text-[#f5f5f5] disabled:opacity-40"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
      <p className="mt-3 text-[13px] text-[#ffffff] [text-shadow:0_1px_3px_#000]">
        From prompt to working SDK, in one workspace.
      </p>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#ffffffd0] [text-shadow:0_1px_3px_#000]">
        <span className="inline-flex items-center gap-1.5">
          <kbd className="rounded-[5px] border border-solid border-[#ffffff2e] bg-[#00000055] px-1.5 py-0.5 font-sans text-[11px] text-[#ffffff]">
            Enter
          </kbd>
          to send
        </span>
        <span className="inline-flex items-center gap-1.5">
          <kbd className="rounded-[5px] border border-solid border-[#ffffff2e] bg-[#00000055] px-1.5 py-0.5 font-sans text-[11px] text-[#ffffff]">
            Shift Enter
          </kbd>
          for a new line
        </span>
      </p>
      {notice ? (
        <p className="mt-3 font-mono text-[11px] text-[#ffffff] uppercase [text-shadow:0_1px_3px_#000]" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {notice ? (
        <div className="mt-3">
          <WalletButton compact />
        </div>
      ) : null}
    </form>
  );
}

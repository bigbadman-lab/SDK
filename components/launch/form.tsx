"use client";

import { RehearsalActions } from "@/components/launch/rehearsal-actions";
import { LaunchResume } from "@/components/launch/launch-progress";
import { LaunchSigningStatus } from "@/components/launch/signing-status";
import {
  LaunchCapabilityDiagnostic,
  LaunchCapabilityNotice,
} from "@/components/launch/wallet-capability";
import { trapDialogFocus } from "@/lib/dialog";
import {
  canOpenConfirmation,
  confirmationStale,
  type ConfirmationDraft,
} from "@/lib/launch/confirm";
import { checkImage } from "@/lib/launch/image";
import { networkCostCopy } from "@/lib/launch/cost";
import { launchMessage } from "@/lib/launch/messages";
import { audiencePair } from "@/lib/launch/verified-launch";
import {
  canonicalAmount,
  parseBuy,
  parseTokenFields,
  type LaunchReview,
  type LaunchSourceView,
  type PrepareSource,
} from "@/lib/launch/prepare";
import type { OpenLaunch } from "@/lib/launch/post-launch";
import { loadBrowserSession, subscribeBrowserSession } from "@/lib/auth/browser-session";
import { ImagePlus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from "react";

const fieldClass =
  "w-full rounded-lg border border-solid border-border bg-background px-3 py-2 text-[15px] text-foreground";

export function LaunchForm({
  source,
  rehearsal = false,
  mintRegistered = false,
}: {
  source: LaunchSourceView;
  rehearsal?: boolean;
  mintRegistered?: boolean;
}): ReactNode {
  const idempotencyKey = useRef(crypto.randomUUID());
  const lock = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [preparationId, setPreparationId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [buyAmount, setBuyAmount] = useState("0");
  const [slippageBps, setSlippageBps] = useState(100);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [artworkSize, setArtworkSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [artworkError, setArtworkError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<"artwork" | "prepare" | null>(null);
  const [confirm, setConfirm] = useState<LaunchReview | null>(null);
  const [tracked, setTracked] = useState<OpenLaunch | null>(null);
  const confirmRef = useRef<LaunchReview | null>(null);
  function setConfirmation(next: LaunchReview | null): void {
    confirmRef.current = next;
    setConfirm(next);
  }

  const draft = useMemo(
    () =>
      currentDraft({
        name,
        symbol,
        description,
        website,
        twitter,
        telegram,
        buyAmount,
        slippageBps,
        assetId,
      }),
    [
      name,
      symbol,
      description,
      website,
      twitter,
      telegram,
      buyAmount,
      slippageBps,
      assetId,
    ]
  );

  function invalidate(next: ConfirmationDraft): void {
    const current = confirmRef.current;
    if (current && confirmationStale(current, next)) setConfirmation(null);
  }

  function snapshot(
    patch: Partial<{
      name: string;
      symbol: string;
      description: string;
      website: string;
      twitter: string;
      telegram: string;
      buyAmount: string;
      slippageBps: number;
      assetId: string | null;
    }>
  ): ConfirmationDraft {
    return currentDraft({
      name,
      symbol,
      description,
      website,
      twitter,
      telegram,
      buyAmount,
      slippageBps,
      assetId,
      ...patch,
    });
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (confirm && !dialog.open) dialog.showModal();
    if (!confirm && dialog.open) dialog.close();
  }, [confirm]);

  async function onFile(file: File | undefined): Promise<void> {
    if (!file || lock.current) return;
    setArtworkError(null);
    if (file.size > 5_000_000) {
      setArtworkError("Artwork must be 5 MB or smaller.");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = await checkImage(bytes);
    if (!checked.ok) {
      setArtworkError(checked.error);
      return;
    }
    lock.current = true;
    setPending("artwork");
    try {
      const response = await fetch("/api/launch/artwork", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": checked.type },
        body: bytes,
      });
      const body = (await response.json()) as {
        assetId?: string;
        previewUrl?: string;
        error?: string;
        width?: number;
        height?: number;
      };
      if (!response.ok || !body.assetId || !body.previewUrl) {
        setArtworkError(body.error ?? "The artwork could not be stored.");
        return;
      }
      invalidate(snapshot({ assetId: body.assetId }));
      setAssetId(body.assetId);
      setPreview(body.previewUrl);
      setArtworkSize({
        width: body.width ?? checked.width,
        height: body.height ?? checked.height,
      });
    } catch {
      setArtworkError("The artwork could not be stored.");
    } finally {
      lock.current = false;
      setPending(null);
    }
  }

  async function prepare(): Promise<void> {
    if (lock.current) return;
    if (!assetId) {
      setArtworkError("Upload square PNG or JPEG artwork first.");
      setNotice(null);
      return;
    }
    const fields = parseTokenFields({
      name: name.trim(),
      symbol: symbol.trim(),
      description: description.trim(),
      website: website.trim() || null,
      twitter: twitter.trim() || null,
      telegram: telegram.trim() || null,
    });
    if (!fields.ok) {
      setNotice(launchMessage(fields.code));
      return;
    }
    const amount = parseBuy(
      buyAmount.trim() || "0",
      draft.buying ? slippageBps : null
    );
    if (!amount.ok) {
      setNotice(launchMessage(amount.code));
      return;
    }
    lock.current = true;
    setPending("prepare");
    setNotice(null);
    setConfirmation(null);
    try {
      const response = await fetch("/api/launch/prepare", {
        method: "POST",
        credentials: "same-origin",
        headers: rehearsal
          ? { "content-type": "application/json", "x-sdk-rehearsal": "trest" }
          : { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: idempotencyKey.current,
          preparationId,
          source: sourcePayload(source),
          name: fields.value.name,
          symbol: fields.value.symbol,
          description: fields.value.description,
          website: fields.value.website,
          twitter: fields.value.twitter,
          telegram: fields.value.telegram,
          assetId,
          buyAmount: amount.amount,
          slippageBps: amount.slippageBps,
        }),
      });
      const body = (await response.json()) as LaunchReview & { error?: string };
      if (!response.ok || !canOpenConfirmation(body, source)) {
        setNotice(body.error ?? "The token details could not be confirmed.");
        return;
      }
      setPreparationId(body.id);
      setConfirmation(body);
    } catch {
      setNotice("The token details could not be confirmed.");
    } finally {
      lock.current = false;
      setPending(null);
    }
  }

  return (
    <div className="mt-6">
      <form
        className="grid gap-4 border border-solid border-border p-4 min-[561px]:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void prepare();
        }}
      >
        <SdkStrip source={source} rehearsal={rehearsal} />
        {rehearsal ? (
          <p className="border border-solid border-border bg-card px-3 py-2 text-[13px] leading-[1.5]">
            TREST rehearsal. This preparation is paired with the registered TREST mint. Signing opens only after preflight and approval of this build.
          </p>
        ) : null}
        <section className="grid gap-4">
          <h2 className="font-mono text-[10px] tracking-[0.06em] uppercase">Token details</h2>
        <div className="grid items-start gap-4 min-[561px]:grid-cols-[168px_minmax(0,1fr)]">
          <ArtworkField
            inputRef={fileRef}
            preview={preview}
            artworkSize={artworkSize}
            error={artworkError}
            dragging={dragging}
            pending={pending === "artwork"}
            onPick={(file) => void onFile(file)}
            onDragEnter={(event) => {
              event.preventDefault();
              dragDepth.current += 1;
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              event.preventDefault();
              dragDepth.current -= 1;
              if (dragDepth.current <= 0) {
                dragDepth.current = 0;
                setDragging(false);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              void onFile(event.dataTransfer.files[0]);
            }}
          />
          <div className="grid gap-3">
            <Field label="Token name" htmlFor="token-name">
              <input
                id="token-name"
                className={fieldClass}
                value={name}
                maxLength={32}
                required
                onChange={(event) => {
                  const value = event.target.value;
                  invalidate(snapshot({ name: value }));
                  setName(value);
                }}
              />
            </Field>
            <Field label="Ticker" htmlFor="token-symbol">
              <input
                id="token-symbol"
                className={fieldClass}
                value={symbol}
                maxLength={13}
                required
                autoCapitalize="characters"
                spellCheck={false}
                onChange={(event) => {
                  const value = event.target.value;
                  invalidate(snapshot({ symbol: value }));
                  setSymbol(value);
                }}
              />
            </Field>
          </div>
        </div>
        <Field label="Description" htmlFor="token-description">
          <textarea
            id="token-description"
            className={fieldClass}
            rows={3}
            value={description}
            maxLength={500}
            required
            onChange={(event) => {
              const value = event.target.value;
              invalidate(snapshot({ description: value }));
              setDescription(value);
            }}
          />
        </Field>
        </section>
        <section className="grid gap-3 border border-solid border-border px-3 py-3">
          <h2 className="font-mono text-[10px] tracking-[0.06em] uppercase">
            Links
            <span className="ml-2 tracking-[0.04em] text-muted-foreground">Optional</span>
          </h2>
          <div className="grid gap-3 min-[561px]:grid-cols-3">
            <Field label="Website" htmlFor="token-website">
              <input
                id="token-website"
                className={fieldClass}
                value={website}
                inputMode="url"
                placeholder="https://"
                onChange={(event) => {
                  const value = event.target.value;
                  invalidate(snapshot({ website: value }));
                  setWebsite(value);
                }}
              />
            </Field>
            <Field label="X" htmlFor="token-x">
              <input
                id="token-x"
                className={fieldClass}
                value={twitter}
                inputMode="url"
                placeholder="https://x.com/"
                onChange={(event) => {
                  const value = event.target.value;
                  invalidate(snapshot({ twitter: value }));
                  setTwitter(value);
                }}
              />
            </Field>
            <Field label="Telegram" htmlFor="token-telegram">
              <input
                id="token-telegram"
                className={fieldClass}
                value={telegram}
                inputMode="url"
                placeholder="https://t.me/"
                onChange={(event) => {
                  const value = event.target.value;
                  invalidate(snapshot({ telegram: value }));
                  setTelegram(value);
                }}
              />
            </Field>
          </div>
        </section>
        <section className="grid gap-3">
          <h2 className="font-mono text-[10px] tracking-[0.06em] uppercase">Launch settings</h2>
          <p className="text-[14px] leading-[1.5] text-muted-foreground">
            Paired with {audiencePair(rehearsal).label}. Creator fees {source.feeLabel}.
          </p>
        <div
          className={
            draft.buying
              ? "grid gap-3 min-[561px]:grid-cols-[minmax(0,1fr)_148px] min-[561px]:items-end"
              : "grid"
          }
        >
          <Field label={`Developer buy · ${audiencePair(rehearsal).label}`} htmlFor="token-buy">
            <input
              id="token-buy"
              className={fieldClass}
              inputMode="decimal"
              value={buyAmount}
              onChange={(event) => {
                const value = event.target.value;
                invalidate(snapshot({ buyAmount: value }));
                setBuyAmount(value);
              }}
            />
          </Field>
          {draft.buying ? (
            <Field label="Slippage" htmlFor="token-slippage">
              <select
                id="token-slippage"
                className={fieldClass}
                value={slippageBps}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  invalidate(snapshot({ slippageBps: value }));
                  setSlippageBps(value);
                }}
              >
                <option value={100}>1%</option>
                <option value={200}>2%</option>
                <option value={500}>5%</option>
                <option value={1000}>10%</option>
              </select>
            </Field>
          ) : null}
        </div>
        <p className="text-[13px] leading-[1.5] text-muted-foreground">
          {rehearsal
            ? "Optional, bundled into the launch transaction and denominated in TREST."
            : "Optional, bundled into the launch transaction. Developer buy will be quoted when the $SDK launch market is available."}
        </p>
        </section>
        {notice ? (
          <p role="alert" className="text-[14px] leading-[1.5] text-foreground">
            {notice}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending !== null}
          aria-busy={pending === "prepare"}
          className="rounded-lg border border-solid border-accent bg-accent px-4 py-3.5 font-mono text-[11px] tracking-[0.08em] text-accent-foreground uppercase disabled:opacity-60"
        >
          Launch Token
        </button>
      </form>
      {tracked && !confirm ? (
        <div className="mt-6">
          <LaunchResume launch={tracked} />
        </div>
      ) : null}
      <dialog
        ref={dialogRef}
        aria-labelledby="confirm-launch-title"
        data-preparation-id={confirm?.id ?? ""}
        data-content-hash={confirm?.contentHash ?? ""}
        className="max-h-[calc(100%-32px)] w-[min(480px,calc(100%-32px))] overflow-y-auto rounded-[14px] border border-solid border-border bg-card p-5 text-foreground backdrop:bg-[#00000080]"
        onKeyDown={trapDialogFocus}
        onClose={() => setConfirmation(null)}
      >
        {confirm ? (
          <ConfirmLaunch
            review={confirm}
            rehearsal={rehearsal}
            mintRegistered={mintRegistered}
            onEdit={() => setConfirmation(null)}
            onTrack={setTracked}
          />
        ) : null}
      </dialog>
    </div>
  );
}

function ArtworkField({
  inputRef,
  preview,
  artworkSize,
  error,
  dragging,
  pending,
  onPick,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  preview: string | null;
  artworkSize: { width: number; height: number } | null;
  error: string | null;
  dragging: boolean;
  pending: boolean;
  onPick: (file: File | undefined) => void;
  onDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}): ReactNode {
  return (
    <div className="grid gap-2">
      <div
        role="group"
        aria-labelledby="artwork-label"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`grid min-h-42 content-center justify-items-center gap-2 border border-dashed px-3 py-4 text-center ${
          dragging
            ? "border-accent bg-background"
            : "border-border bg-background"
        }`}
      >
        <input
          ref={inputRef}
          id="token-artwork"
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg"
          aria-label="Token artwork"
          aria-describedby={
            error ? "artwork-hint artwork-error" : "artwork-hint"
          }
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            onPick(file);
          }}
        />
        {preview && artworkSize ? (
          <Image
            src={preview}
            alt="Selected token artwork"
            width={artworkSize.width}
            height={artworkSize.height}
            unoptimized
            className="h-24 w-24 object-contain"
          />
        ) : (
          <ImagePlus aria-hidden="true" className="h-6 w-6 text-accent-ink" />
        )}
        <p id="artwork-label" className="text-[14px] leading-[1.4]">
          Upload token image
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg border border-solid border-border bg-card px-3 py-2 font-mono text-[10px] tracking-[0.04em] uppercase disabled:opacity-60"
        >
          {preview ? "Replace image" : "Choose image"}
        </button>
        <p
          id="artwork-hint"
          className="text-[12px] leading-[1.4] text-muted-foreground"
        >
          Square PNG or JPEG · Max 5 MB
        </p>
      </div>
      {error ? (
        <p
          id="artwork-error"
          role="alert"
          className="text-[13px] leading-[1.45]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ConfirmLaunch({
  review,
  rehearsal,
  mintRegistered,
  onEdit,
  onTrack,
}: {
  review: LaunchReview;
  rehearsal: boolean;
  mintRegistered: boolean;
  onEdit: () => void;
  onTrack: (launch: OpenLaunch) => void;
}): ReactNode {
  const links = [review.website, review.twitter, review.telegram].filter(
    (link): link is string => Boolean(link)
  );
  return (
    <>
      <h2
        id="confirm-launch-title"
        className="font-display text-[28px] leading-[1.15]"
      >
        Confirm Token Launch
      </h2>
      <div className="mt-4 grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3">
        <Image
          src={review.artworkUrl}
          alt={`${review.tokenName} artwork`}
          width={review.artworkWidth}
          height={review.artworkHeight}
          unoptimized
          className="h-16 w-16 object-contain"
        />
        <div className="min-w-0">
          <p className="truncate text-[16px]">
            {review.tokenName}{" "}
            <span className="text-muted-foreground">${review.tokenSymbol}</span>
          </p>
          <p className="flex items-center gap-2 truncate text-[13px] text-muted-foreground">
            <Image
              src="/images/sdkpair.png"
              alt=""
              width={20}
              height={20}
              className="h-5 w-5 rounded-lg object-contain"
            />
            Paired with {audiencePair(rehearsal).label}
          </p>
        </div>
      </div>
      <p className="mt-3 line-clamp-3 text-[14px] leading-[1.5] text-muted-foreground">
        {review.tokenDescription}
      </p>
      <dl className="mt-4 grid gap-2 text-[14px] leading-[1.45]">
        <Row term="SDK" value={review.name} />
        <Row term="Pair" value={audiencePair(rehearsal).label} />
        <Row
          term="Developer buy"
          value={review.buyAmount === "0" ? "None" : `${review.buyAmount} ${audiencePair(rehearsal).label}`}
        />
        {review.slippageBps ? (
          <Row term="Slippage" value={`${review.slippageBps / 100}%`} />
        ) : null}
        <Row term="Creator fees" value={review.feeLabel} />
        <Row term="Network" value={networkCostCopy()} />
        <ApprovingWallet />
        <Row term="Originator" value={review.originatorLabel} />
        <Row
          term="Metadata"
          value={
            review.metadataPinned && review.metadataUri
              ? "Pinned and ready"
              : "Not ready"
          }
        />
      </dl>
      {review.metadataUri ? (
        <p className="mt-2 font-mono text-[10px] break-all text-muted-foreground">
          {review.metadataUri}
        </p>
      ) : null}
      {links.length > 0 ? (
        <p className="mt-3 text-[13px] break-all text-muted-foreground">
          {links.join(" · ")}
        </p>
      ) : null}
      <LaunchCapabilityDiagnostic surface="modal" />
      <LaunchCapabilityNotice />
      {rehearsal ? (
            <RehearsalActions review={review} onTrack={onTrack} />
      ) : (
        <>
          <LaunchSigningStatus
            phase="unavailable"
            body={
              mintRegistered
                ? "Public launches stay paired with $SDK. Signing and submission are not available from this screen."
                : "Token launching opens when the official $SDK mint is registered."
            }
          />
          <div className="mt-4 flex flex-col-reverse gap-2 min-[561px]:flex-row min-[561px]:justify-end">
            <button
              type="button"
              disabled
              aria-describedby="launch-not-ready"
              data-preparation-id={review.id}
              className="rounded-lg border border-solid border-accent bg-accent px-3 py-2.5 font-mono text-[10px] tracking-[0.04em] text-accent-foreground uppercase disabled:cursor-not-allowed disabled:opacity-40"
            >
              Launch Token
            </button>
          </div>
        </>
      )}
      <div className="mt-4 flex flex-col-reverse gap-2 min-[561px]:flex-row min-[561px]:justify-end">
        <button
          type="button"
          autoFocus
          onClick={onEdit}
          className="rounded-lg border border-solid border-border bg-background px-3 py-2.5 font-mono text-[10px] tracking-[0.04em] uppercase"
        >
          Back to Edit
        </button>
      </div>
    </>
  );
}

function Row({ term, value }: { term: string; value: string }): ReactNode {
  return (
    <div className="grid grid-cols-[108px_minmax(0,1fr)] gap-3">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}

function SdkStrip({ source, rehearsal = false }: { source: LaunchSourceView; rehearsal?: boolean }): ReactNode {
  return (
    <div className="grid gap-1 border-b border-solid border-border pb-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] tracking-[0.06em] text-accent-ink uppercase">
          Your selected SDK
        </p>
        <Link
          href={rehearsal ? "/launch?rehearsal=trest" : "/launch"}
          className="font-mono text-[10px] tracking-[0.04em] uppercase"
        >
          Choose another SDK
        </Link>
      </div>
      <h2 className="font-display text-[26px] leading-[1.15] tracking-[-0.4px]">
        {source.name}
      </h2>
      <p className="line-clamp-2 text-[14px] leading-[1.5] text-muted-foreground">
        {source.description}
      </p>
      <p className="font-mono text-[10px] tracking-[0.04em] uppercase">
        {source.provenance} · {source.versionLabel}
      </p>
      <p className="font-mono text-[10px] break-all text-muted-foreground">
        {source.contentHash}
      </p>
    </div>
  );
}

function ApprovingWallet(): ReactNode {
  const [address, setAddress] = useState<string | null>(null);
  useEffect(() => {
    void loadBrowserSession();
    return subscribeBrowserSession((next) => {
      setAddress(next.status === "signed-in" ? next.walletAddress : null);
    });
  }, []);
  const visible = address ? `${address.slice(0, 4)}…${address.slice(-4)}` : "The wallet connected for this launch";
  return <Row term="Wallet" value={visible} />;
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="grid gap-1.5">
      <label
        htmlFor={htmlFor}
        className="font-mono text-[10px] tracking-[0.06em] uppercase"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function sourcePayload(source: LaunchSourceView): PrepareSource {
  if (source.kind === "draft" && source.draftId)
    return { kind: "draft", draftId: source.draftId };
  if (source.librarySdkId)
    return {
      kind: "library",
      sdkId: source.librarySdkId,
      versionId: source.versionId,
    };
  return { kind: "draft", draftId: source.draftId ?? "" };
}

function currentDraft(input: {
  name: string;
  symbol: string;
  description: string;
  website: string;
  twitter: string;
  telegram: string;
  buyAmount: string;
  slippageBps: number;
  assetId: string | null;
}): ConfirmationDraft {
  const amount = canonicalAmount(input.buyAmount.trim() || "0");
  return {
    name: input.name,
    symbol: input.symbol,
    description: input.description,
    website: input.website,
    twitter: input.twitter,
    telegram: input.telegram,
    buyAmount: input.buyAmount,
    slippageBps: input.slippageBps,
    assetId: input.assetId,
    buying: amount !== null && amount !== "0",
  };
}

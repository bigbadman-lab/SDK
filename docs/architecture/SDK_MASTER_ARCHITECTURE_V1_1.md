# SDK — Master MVP Architecture Specification v1.1

**Prepared:** 18 October 2026  
**Status:** Consolidated architecture for final user review — **not yet final architecture sign-off**  
**Implementation status:** No implementation authorized; no Cursor implementation prompts; no GitHub changes.  
**Sources of decisions:** `SDK_MVP_HANDOVER_ARCHITECTURE(1).md` (18 October 2026), subsequent SDK architecture approvals in this conversation, and inspection of `agentframe.zip`.  
**Precedence:** Newer explicit approvals here supersede open/proposed or older values in the original handover. Nothing marked *requires verification* may be silently declared operational.

---

## 0. Executive architecture decision

SDK is a **unified AI-powered SDK creation and token-launch platform**. Users build and test real working SDKs, then **launch a child token paired with native $SDK to automatically publish a public, token-associated SDK product**. Token launching is integral to the public product journey, not an optional add-on to an independent SDK publishing platform. SDK developers may separately submit working SDK Blueprints to the token-free, operator-approved community library so that other users can select, remix and launch them. The MVP includes a conversational AI Builder, one shared Blueprint engine, ten functioning official library SDKs, day-one community submissions, one universal NPM client for launched products, child token launches, developer royalties, native holder rewards and an SDK Feed.

**Minimal deployment:**

1. **Vercel / Next.js** — dark-first Agentframe-derived frontend, server APIs, sessions, conversational Builder, shared SDK engine, marketplace, product pages, launches orchestration, Feed and universal API.
2. **Supabase PostgreSQL** — authoritative application data, immutable versions, provenance, session/API key records, durable jobs, canonical mint, and audited financial ledger.
3. **Render transaction-builder service** — prepares and validates unsigned Pump custom-pair transactions, verified fee recipients and ALT readiness; does not hold creator signing keys.
4. **Render native rewards worker** — independent native creator-fee collection, holder accounting, buybacks, funded claims, operator recovery and financial signing.

This means **one application, one database and two specialized Render services**, not a fleet of per-SDK or per-token backends. OpenAI, Helius, Reown, Pump, Birdeye and Pinata are external providers, not additional SDK-operated services.

**Four non-negotiables:** (1) Publish = Live: no fake SDK outputs, token success, trading metrics or payouts; (2) Builder failure never stops financial processing; (3) native rewards failure never stops SDK execution or verified child launches; (4) only *finalized evidence* establishes a successful financial outcome.

---

## 1. Decision register

| ID | Area | Approved decision |
|---|---|---|
| 01A | Blueprint model | Declarative, typed, sequential interpreter, up to **5 steps**; no code execution, loops, recursion or parallel execution |
| 01B | Operation registry | **6 operation types**: `ai.generate`, `ai.analyze`, `solana.account`, `solana.transactions`, `solana.token`, `data.transform` |
| 02 | Official SDKs | Exactly **10 functioning official SDKs**, names/purposes specified in §3 |
| 03 | Child royalty economics | **60% token creator / 25% originating SDK developer / 15% platform** on eligible creator fees; overlapping payees aggregated |
| 04A | Native economics | **30% SOL holder rewards / 30% SOL spent on real $SDK buybacks for holders / 40% operations** |
| 04B | Eligibility | At least **50,000 native $SDK** at the five-minute cutoff, replacing any historical USD-threshold requirement |
| 04C | Operator recovery | Private, manually triggered ability to recover **already credited but unclaimed** SOL/$SDK rewards to the canonical deployer wallet; no timer or minimum holding period; implementation allowed, live entitlement recovery subject to legal approval/disclosure |
| 05 | Canonical native activation | One verified native mint, one operator action, automatic ALT preparation, no manual redeploy/feature-flag choreography |
| 06 | Architecture boundaries | One Vercel app, one Supabase database, one Render transaction builder, one separate Render native financial worker; six database domains |
| 07 | Authentication and API | Reown + verified wallet-signature login; free metered usage; scoped revocable keys; one NPM client; PostgreSQL quota accounting |
| 08A | Blueprint v1 limits | 5 steps, **5 OpenAI requests**, **10 Helius requests**, **60s** runtime, **4,000 output tokens per AI call**, **40,000 input characters per text field**, **128KB** final output, **100** transaction records, **5** transform actions |
| 08B | Financial integration | Prefer Pump-native child fee sharing; independent custom native reward worker; real fee collection, swap and receipt verification; two mainnet rehearsals |
| UI | Design | `agentframe.zip` is the selected **dark-first** template; user confirms its licence allows source in public SDK repo |
| PRODUCT | Unified build-and-launch model | **Build → Test → Launch (automatic publication)** for token launchers; **Build → Test → Submit → Approve → Available for Launch** for token-free community developer contributions |

**Important policy clarification:** Decision 04C intentionally supersedes the earlier “funded credits remain indefinitely owed even after holdings change” assumption **with respect to discretionary operator recovery**. Holder eligibility and post-sale balances remain as previously designed unless/until a legally cleared recovery occurs. During initial build do **not** add clawback/recovery wording to the public rewards interface; add public copy only on the user's express later instruction after legal sign-off. Do **not** enable reclaiming real user entitlements prior to appropriate legal clearance and disclosure. The function and its audit/ledger protections can be implemented and tested in development.

---

## 2. Product scope and core user journeys

### 2.1 Unified Build → Test → Launch model

- The homepage's principal CTA is **a natural-language, free-flow AI SDK Builder**, not a fixed wizard. Iterative requests revise validated Blueprints.
- Users may **build, save, test and revise private drafts before token launch**; these are not independently published token-associated SDK products.
- **Build → Test → Launch (automatically publishes):** the user either builds an SDK in the conversational Builder or selects/remixes an approved official/community SDK; genuinely tests it; then launches a child token paired with $SDK. Only verified finalized token creation automatically produces the public launched SDK product, pinned integration access, token page and Feed announcement. There is **no separate Publish button** for token launchers.
- The launched product is inseparable from its verified token identity, although the SDK can be used without owning or purchasing that token.
- Every preview, official listing, community listing, remix, NPM call and token product page invokes the **same validated runtime**.
- Every **launched SDK product** is usable software with typed inputs, real results, operation inspection, copyable NPM/API integration guidance and honest activity statistics. Official and approved community SDK library entries are also genuinely runnable, but are **reusable templates/listings**, not independently launched token products.
- No user-provided JavaScript/TypeScript, external NPM modules, arbitrary backend uploads, arbitrary HTTP execution, autonomous agents or persistent jobs.

### 2.2 Official Library and Marketplace

- Exactly ten official SDKs, fully executable at MVP release.
- Each official listing offers **Try SDK / Remix SDK / Launch Token**.
- An authenticated developer follows **Build → Test → Submit → Operator approval → Available for Launch**, **without minting a token**. Approval publishes a *reusable community library listing*, not a token-associated SDK product or a Feed launch announcement.
- Review applies to community **SDK listings**, not individual launches from already approved listings.
- A single approved SDK can power **multiple separate child tokens**.
- Remixes preserve a source SDK and source-version pointer. Where the remix retains a community-origin capability, its originating approved developer continues to receive the royalty. New builds from base capabilities can establish new authorship. **No AI similarity-based ownership guessing** and no multi-author royalty graph.
- Operator moderation rejects nonworking, misleading, unsupported or abusive community submissions.

### 2.3 Token ecosystem and automatic publication

- Every child token uses native **$SDK as the fixed Pump quote asset**, not SOL or USDC.
- Child-token launch binds an immutable SDK Blueprint version, originating developer beneficiary, token creator and verified 60/25/15-equivalent recipients.
- The user wallet signs; SDK's transaction builder never takes the user's private key.
- After **finalized verification**, token launch automatically publishes the **working token-associated SDK product page**, makes its pinned version available through the universal NPM/API integration, and queues the Feed announcement. No additional human Publish action exists.
- Child-token product pages show a **working playground**, Execution Inspector, SDK integration docs, origin/developer/creator, token mint and market data where available.
- SDK Feed automatically and idempotently announces **finalized verified launches**; users can browse anonymously and wallet-authenticated users can like/comment. Feed unavailability never invalidates a verified launch.

### 2.4 Publication identities and invariants

| Artifact | May exist without a token? | Public meaning |
|---|---|---|
| Private SDK draft/version | **Yes** | Builder workspace and genuine test runs, not a publicly launched product |
| Official SDK library entry | **Yes** | Operator-provided executable, reusable template with Try / Remix / Launch |
| Approved community SDK library entry | **Yes** | Operator-approved executable, reusable developer submission; originating developer attribution is trusted |
| Launched SDK product | **No** | **Only** created by a verified finalized child-token launch, with immutable Blueprint version, public integration, product page and Feed announcement |

- The same underlying Blueprint may be tested or reused before launch. This does **not** grant it a separate token-free product-publication pathway.
- Multiple child tokens may launch against the same official or approved community SDK, producing **distinct launched products** and royalty configurations.
- Community listing approval is not token launch or SDK Feed publication. The originating SDK developer does not need to launch a token to earn royalties when someone else launches their approved SDK.
- The universal NPM client is one package; its public launched-product integration must identify the launched product and resolve the correct pinned Blueprint version, even when multiple tokens reuse the same underlying SDK.

### 2.5 Native holder experience

- Five-minute accounting windows from actual native-token launch (with recovery for activation lag).
- Minimum **50,000 $SDK at the relevant cutoff**; eligible wallets share distributions pro rata by eligible token balance.
- **30%** of collected eligible native SOL creator fees backed as claimable SOL; **30%** spent on actual on-chain $SDK buybacks and credited as purchased $SDK; **40%** operations.
- A single **Claim All** initiates real transfers of accumulated funded SOL and $SDK.
- Distinguish `observed`, `collected`, `allocated`, `buyback pending`, `funded`, `claimable`, `paid`, `recovered` rather than collapsing these into one misleading rewards number.

---

## 3. The official ten SDKs — locked names and purposes

| # | SDK | Main function | Illustrative engine pipeline |
|---|---|---|---|
| 01 | **Prompt Architect** | Analyze rough instructions; return improved AI prompts, variable structure and tests | `ai.analyze → ai.generate` |
| 02 | **Data Alchemist** | Extract/normalize pasted records and malformed data into typed, deduplicated JSON | `ai.analyze → data.transform` |
| 03 | **Document Intelligence** | Analyze supplied long-form text for obligations, dates, findings and action items | `ai.analyze → data.transform` |
| 04 | **World Engine** | Create structured fictional settings, rules, factions, characters and scenarios | `ai.generate → ai.analyze` |
| 05 | **PersonaOS** | Produce consistent responses using an explicit persona and bounded supplied conversation context | `ai.analyze → ai.generate` |
| 06 | **Decision Lab** | Compare options, trade-offs, assumptions and plausible outcomes | `ai.analyze → data.transform → ai.generate` |
| 07 | **Chain Investigator** | Bounded, evidence-based wallet behavior and funding-pattern analysis | `solana.account → solana.transactions → data.transform → ai.analyze` |
| 08 | **Token Forensics** | Token mint/authority, supply, bounded holder concentration and risk indicators | `solana.token → solana.transactions → data.transform → ai.analyze` |
| 09 | **Wallet DNA** | Real wallet activity into a shareable, explicitly playful on-chain persona | `solana.transactions → data.transform → ai.generate` |
| 10 | **Venture Forge** | Produce structured venture positioning, scope, priorities and launch strategy | `ai.analyze → ai.generate → data.transform` |

Pipelines above are **design targets**, not proofs of executed provider calls. Every SDK must run with actual, validated inputs and outputs before its listing is live. Product diversity is intentional: SDK must not resemble a collection of basic Helius scanners.

**Specific boundaries:** Document Intelligence supports submitted text at MVP, not automatic PDF/OCR ingestion; PersonaOS is user-provided bounded context, not a background agent; Token Forensics reports evidence and uncertainties, not definitive scam certifications; Chain Investigator must distinguish bounded observations from asserted relationships; World Engine is a structured one-shot application rather than a persistent world engine.

---

## 4. Blueprint execution contract — approved v1 shape

### 4.1 Separation of concerns

- **SDK identity:** stable `sdkId`, owner, display metadata.
- **Blueprint version:** immutable `versionId`, `schemaVersion = "1.0"`, content hash, typed inputs, ordered steps, outputs, requested capabilities and bounded limits.
- **Execution:** unique `executionId`, caller context, immutable referenced Blueprint version, validated inputs, verified operation traces and result/error.
- **Trusted side records:** review status, attribution, royalties, token mint and finance **do not come from executable Blueprint/browser instructions**.

### 4.2 Proposed canonical payload envelope

The following is the **approved structural shape**, with exact per-operation JSON Schema to be finalized during specification-to-code translation. Do not mistake example response-schema names for already registered implementations.

```json
{
  "schemaVersion": "1.0",
  "name": "Prompt Architect",
  "description": "Analyze and improve an AI prompt",
  "inputs": {
    "prompt": {"type": "string", "required": true, "maxLength": 40000},
    "goal": {"type": "string", "required": true, "maxLength": 40000}
  },
  "steps": [
    {
      "id": "analyze",
      "op": "ai.analyze",
      "config": {"task": "Assess clarity and missing constraints", "responseSchema": "prompt_analysis_v1"},
      "args": {"text": {"$ref": "inputs.prompt"}, "goal": {"$ref": "inputs.goal"}}
    },
    {
      "id": "improve",
      "op": "ai.generate",
      "config": {"task": "Return improved prompt and examples", "responseSchema": "prompt_result_v1"},
      "args": {"analysis": {"$ref": "steps.analyze.result"}}
    }
  ],
  "outputs": {"result": {"type": "object", "from": {"$ref": "steps.improve.result"}}},
  "limits": {"timeoutMs": 60000, "maxOutputBytes": 131072},
  "capabilities": ["ai.analyze", "ai.generate"]
}
```

### 4.3 Locked operation types and allowable modes

| Operation | Approved purpose | Mode examples to implement and type-check |
|---|---|---|
| `ai.generate` | Bounded OpenAI structured/creative generation | declared response schema and approved instruction/context |
| `ai.analyze` | Bounded OpenAI analysis of supplied text/structured evidence | findings, synthesis and structured extraction |
| `solana.account` | Helius read-only Solana account/wallet inspection | account info, wallet balances |
| `solana.transactions` | Helius read-only bounded transaction inspection | recent activity, transaction detail |
| `solana.token` | Helius read-only token inspection | mint info, supply, bounded holder summary |
| `data.transform` | Safe deterministic processing | select, filter, sort, aggregate, deduplicate, format, bounded calculate |

**No seventh operation type at MVP.** The platform controls mode registries, allowed config arguments, model/RPC selectors, internal provider-call counts and operation implementation versions. A single Blueprint step may perform more than one *bounded internal provider request*, counted against the full run's quota. No arbitrary scripts or custom provider endpoints.

### 4.4 References, validation and output

- Accepted user-facing input types: **`string`, `number`, `boolean`, `enum`, `solanaAddress`**. Earlier step results may contain bounded typed arrays/objects.
- References use a strict form such as `{"$ref":"inputs.prompt"}` or `{"$ref":"steps.fetch.result.transactions"}`.
- References may access only declared inputs or **earlier** step results, never a later step, secrets, foreign runs, raw database data or arbitrary property paths.
- Inputs, operation argument shapes, reference types and final outputs are validated at the server. A failed required step means no fake success.
- Blueprint versions bound to child tokens are immutable. Compatibility of their registered operation contracts must be retained or a new version explicitly published.
- Playground forms and integration documentation are generated from the same declared input/output specification.

### 4.5 Hard MVP execution ceilings

| Control | Approved maximum |
|---|---:|
| Blueprint operations | **5 sequential** |
| OpenAI requests in one run | **5** |
| Helius requests in one run | **10** |
| Overall run duration | **60 seconds** |
| AI output tokens per request | **4,000** |
| Text characters per field | **40,000** |
| Final serialized output | **128 KB** |
| Transaction records in a bounded query | **100** |
| Deterministic transform actions | **5** |

**Additional safety ceilings are required but not numerically locked yet:** aggregate AI input+output token budget, maximum provider spend per execution and per account/global period, concurrency, nested JSON depth, request body size, and retry policy. Those can be selected using actual cost/timeout evidence without expanding the locked capability set.

### 4.6 Execution state and evidence

Runtime statuses: `RUNNING`, `SUCCESS`, `FAILED`, `REJECTED`, `TIMEOUT`. Store an execution ID, requested SDK/version, safe timestamp/inputs metadata, step statuses and durations, provider request count, outcome, sanitized error code, usage/cost metadata and actual latency. Keep user inputs/outputs private by default; publication of demo examples is explicit. The API returns an accurately typed result or error; never infer successful execution from an HTTP request merely returning.

---

## 5. Authentication, NPM client and usage policy

### 5.1 Authentication

- **Reown AppKit** connects Solana wallets. A domain-bound, nonce-bound, expiring signed message is verified server-side to establish account identity.
- One wallet = one account. Secure HttpOnly server session cookies; proposed seven-day inactivity expiry; logout invalidation; switching wallets requires reauthentication.
- Logging in is **not** authority to sign token launches, payments, transfers or treasury withdrawals.
- Operators have explicit backend authorization independent of visual controls.

### 5.2 Public and developer access

- Anonymous users browse library, docs, products and Feed and have limited public trials.
- Signed-in wallet users create/test/save/remix/submit SDKs, launch tokens, like/comment, and manage account/activity.
- Developer API keys are **execute/docs/usage-scoped only**, revocable, hashed at rest and displayed once at creation. They cannot mint, alter royalties, access treasury, approve submissions or recover rewards.
- One public universal NPM package (name **TBD**) wraps the common versioned API for **verified launched SDK products**. Official/community library listings remain runnable in their website playgrounds before anyone launches them; their status must not be confused with a publicly launched integration product. The key belongs on a developer's server, not embedded in public client JS.
- Illustrative endpoint: `POST /api/v1/sdk/:sdkId/run`; exact ID/name/path and request/error types to finalize before publishing package.
- A **launched token-associated product** resolves its pinned Blueprint version. Official/community library listings can show their latest approved template version for trials/remixing, but only a verified launch automatically establishes a public token-linked product integration.

### 5.3 Locked free-MVP allowances

| Activity | Allowance |
|---|---:|
| Anonymous playground | **3 runs per visitor/day** |
| Signed-in website executions | **20 per wallet/day** |
| Builder messages | **10 per wallet/day** |
| API executions | **100 per wallet/day across its API keys** |
| Active API keys | **5 per wallet** |
| Saved draft SDKs | **20 per account** |
| Community submissions | **3 per wallet/day** |
| Authenticated concurrent executions | **2** |
| Anonymous concurrent executions | **1** |

Daily counters reset at **midnight UTC**, subject to per-run spending limits and safe global provider cost ceilings. Anonymous enforcement can use a bounded visitor ID plus privacy-conscious IP controls and edge throttling; it is deterrence, not foolproof identity verification. PostgreSQL transaction-based quota reservation, without Redis, is the MVP approach. Public browsing is not usage-metered. No subscription or payment billing for SDK use at launch.

---

## 6. Database ownership — one Supabase PostgreSQL instance

**Six logical domains**, with database constraints and least-privilege service roles; these are domains, not six separate databases or services:

1. **Identity/accounts:** wallets, signed sessions, operators, hashed API keys, usage counters.
2. **Blueprint/marketplace:** Builder conversations, drafts, immutable versions/content hashes, official and community listings, submissions, review evidence, remixes and royalty provenance.
3. **Execution/usage:** run records, provider calls/usage, traces, budgets, costs, sanitized errors and retention policy.
4. **Token launch/attribution:** launch drafts and attempts, prepared transaction binds, quote+fee configuration, verified mints, creator/developer/platform attribution, verified launch evidence.
5. **Native financial ledger:** fee source events, collection receipts, window cutoffs, holder snapshots, allocations, buybacks, entitlements, claims, operator recoveries and signer reconciliation.
6. **Feed/discovery:** verified launch posts, likes/comments, moderation, activity aggregates and ranking metadata.

**Canonical configuration** is one additional authoritative record/domain boundary containing the verified native mint, launch evidence, quote infrastructure readiness and activation state.

### 6.1 Integrity invariants

- SDK identity is distinct from Blueprint version, token identity and run identity.
- Published versions cannot be edited; child products pin an immutable version ID/hash.
- Unique finalized child mint; unique idempotent Feed announcement per verified launch.
- All beneficiary wallets derive from trusted, approved attribution records and are frozen as part of the finalized child-token configuration.
- A reward window ID/cutoff is unique; fee events cannot be credited twice; claims and operator recoveries cannot spend the same ledger entitlement twice.
- Financial ledger is auditable; reversals/recoveries are explicit entries, not silent balance rewrites.
- The child-launch service does not edit native financial balances; the SDK engine does not have access to treasury keys.

### 6.2 Service communication and durable work

- **Authenticated HTTP** for immediate actions (Next.js → Render transaction builder).
- **PostgreSQL durable jobs/checkpoints** with unique job IDs, leases, transactional claims and bounded retry for long-running finality verification, Feed publication, financial settlement and claims. No extra Redis/Kafka/queue provider.
- Next.js owns **child launch verification** through a durable bounded invocation that is *independent* of the native worker. Its scheduler/invocation mechanism is **implementation detail to finalize** and cannot depend on a visitor staying on the webpage.
- Render financial worker owns its own scheduled/continuous processing and durable checkpoints.
- Limit DB connection pools for Vercel and Render; do not let SDK-run spikes exhaust worker or database capacity.

---

## 7. Child-token launch and 60/25/15 royalty contract

### 7.1 Launch lifecycle

1. User chooses approved official/community or their own executable SDK and a **specific immutable Blueprint version**.
2. Authenticated server resolves product ownership, source attribution and trusted royalty recipient. No browser-controlled recipients or protocol ID overrides.
3. Next.js requests a verified **unsigned** Pump custom-quote transaction from the Render transaction builder.
4. Transaction builder cross-checks **canonical native $SDK quote mint**, Pump token eligibility, metadata/artwork, program/fee addresses, required ATAs, transaction bytes and required ALT addresses.
5. User signs in their wallet (optional initial buy only when actually supported and properly verified).
6. Launch attempt is durably recorded; on-chain submission/finality and correct quote + fee config are verified independently.
7. Only after finalized evidence: the **launch automatically publishes** its SDK product, registers the pinned public integration, provides its functional page and queues its Feed announcement idempotently; there is no separate publication action.

A lost HTTP response never proves failure; recovery reconciles original signature/mint before resubmission. Published token metadata is immutable where necessary via Pinata/IPFS; upload failures are explicit.

### 7.2 Royalty policy: **LOCKED**

| Case | Creator | Developer | Platform | Distinct payout wallets |
|---|---:|---:|---:|---|
| Approved community SDK launched by someone else | 60% | 25% | 15% | Three, unless overlap |
| Developer launches their own SDK | 85% combined | included | 15% | Two |
| Official platform-owned SDK | 60% | platform-owned 25% | platform 15% | Two (60/40) |
| Approved community remix with retained lineage | 60% | 25% to original approved developer | 15% | Based on overlap |

Fee entitlement is to **eligible child-token creator fees**, not trading volume. The target payout asset is **$SDK as child quote**, subject to proving the actual program transfer mechanics and recipient token accounts. Sum recipient basis points to 10,000 and aggregate overlapping destinations **before** constructing the immutable final on-chain configuration.

**Selected path:** Pump-native creation and fee-sharing instructions, rather than an SDK bespoke child royalty payment system. Verify the installed SDK version, current instruction accounts, whether fee sharing can be configured/finalized before fee-generating initial trades, custom quote ATAs, graduated-fee sweeps and distribution transactions. Dynamic developer recipients must come from approved server records. The MCPX decoder that rejects non-SOL quote events must **not** be ported unchanged.

### 7.3 One prerequisite for real launches

A canonical mint can be marked active only after on-chain identity and quote/ALT readiness evidence passes; launch submission still independently verifies each candidate transaction. Neither a database toggle nor a UI button constitutes token success.

---

## 8. Native $SDK rewards — 30/30/40

### 8.1 Native configuration and ownership

Use a native $SDK creator-fee configuration whose eligible **SOL creator fees** can be collected under the protocol's verified instructions. Do **not** conflate it with Pump-managed holder reward token modes, which do not express SDK's custom buyback + SOL + operations split. Confirm precise creator authority and fee paths for bonding-curve and graduated pool states before mainnet activation.

### 8.2 Windows and holder cutoff

- Five-minute **UTC-boundary** windows from actual verified native launch: if launched mid-window, first partial window starts at launch and closes at the next five-minute UTC boundary.
- Every window records precise cutoff slot, chain-finality evidence and creator-fee source coverage.
- Eligibility: wallet holds at least **50,000 $SDK at cutoff**. Aggregate relevant token-account balances by beneficial wallet under a documented exclusion policy (liquidity/pool/treasury/program vaults and other non-eligible custody).
- No Birdeye/USD eligibility requirement. Birdeye remains useful for public token market metrics.
- Share is `eligibleWalletTokenBalance / sum(allEligibleWalletBalances)` using **integer token base units and deterministic rounding**.
- After a qualifying cutoff, later selling does not alone revoke a credited balance; **the separate approved operator-recovery policy can affect unclaimed entitlements, subject to legal clearance before live use**.

### 8.3 Reliable holder source — **REQUIRES VERIFICATION**

Recommend incremental, finalized token-account/owner tracking with durable slot checkpoints and reconstructable gaps; a top-holder-only API is insufficient. Handle newly created/closed token accounts, transfers, ownership changes, reorg/finality, withheld/locked balances where relevant, missed observations and durable replay. Before claiming correctness, prove completeness and efficient reconstruction at the cutoff. If historical state is uncertain, affected reward windows remain pending rather than using present balances to fabricate historical eligibility.

### 8.4 Fee collection and funding

- Record finalized creator-fee generating events **by the window in which fees were earned**, not the later time they were collected.
- Automatically claim/collect eligible native fees from their actual Pump vault(s), verify on-chain amount received, reconcile source events against collection receipts.
- Per window, reserve **30% in SOL** for holder credits, **30% SOL** for real buybacks, and **40%** as operations, in integer lamports. Keep rounding dust explicitly accounted for.
- If the window has no eligible wallets, retain its allocations in an auditable reserved state pending an explicit disposition policy; do not silently enrich a recipient.
- Window status separates observed/collected/allocated/buyback pending/funded/settled/claimable; no misleading “paid” state before real claim finality.

### 8.5 Real buyback and settlement

- Execute a real on-chain SOL→$SDK acquisition using a verified, liquid Pump route suitable to bonding-curve or PumpSwap state, with bounded slippage and cost.
- A delayed/failed/uneconomic buyback leaves its SOL allocation reserved and retryable; do not simulate acquired $SDK or claimable buybacks.
- On finalized on-chain receipt, divide **actual net acquired SDK** among eligible wallets pro rata and credit only genuinely funded balances.
- An accounting interval is five minutes; buyback execution may settle later and can be safely batched while preserving per-window provenance.
- Never let database claimable liabilities exceed segregated/reserved actual SOL and $SDK treasury backing.

### 8.6 Claims and custody

- A wallet-authenticated **Claim All** requests its cumulative funded SOL and $SDK balances.
- Atomic database reservation prevents simultaneous claims or collision with a recovery operation.
- Treasury signer is isolated to Render native worker; signing requests are policy-bound to verified beneficiaries and reserved amounts.
- Every submitted financial transaction gets an operation ID/signature and immutable audit evidence; unknown outcomes remain pending for reconciliation rather than causing blind repeat transfers.
- Only finalized token/SOL movements mark balances paid. Definitive failures can release a pending reservation after verified reconciliation.
- Do not expose financial signing credentials to the browser, Next.js, Builder or transaction-builder service.

### 8.7 Operator Recover Unclaimed Rewards — exact approved design

- **Private manual operator action**; no scheduled recovery, expiry timer or minimum age rule.
- May target **already credited but still unclaimed** SOL and $SDK, up to balances available and not already in an unresolved claim transaction.
- Transfers recovered funds to the **canonical native $SDK deployer wallet**; records recovery and corresponding reduction/cancellation of affected holder entitlements; prevents claim/recovery race and double-spend.
- **Initial public rewards UI contains zero clawback/recovery-policy wording**, by user's explicit request. Public wording is to be added only after user instruction following legal review.
- **Implementation can be built and development-tested**, but use against real holder entitlements requires prior legal clearance and appropriate disclosure. Legal approval is not assumed; private UI implementation is not authorization to exercise the right live.

### 8.8 Operations

One independent Render worker owns native indexing, fee collection, window settlement, buybacks, claims and recovery. Subtasks use durable checkpoints and transaction reconciliation. Failure in any one window must not halt subsequent indexing or unrelated SDK/child launch functions. Operator view displays observed amounts, backlog, pending fees/swaps, actual backing and unresolved signatures. No fictional balances.

---

## 9. One canonical native mint activation

**Conceptual state transition:** `AWAITING_MINT → ACTIVE`, with durable internal preparation checkpoints rather than multiple operator switches.

1. Operator submits one native $SDK mint in private authenticated activation UI.
2. Verify mainnet token identity, finalized launch origin/slot, Pump eligibility, quote-compatible token program and creator-fee/authority requirements.
3. Derive mint-dependent custom-quote addresses; if needed, **automatically extend the precreated static ALT**, allow required slot warm-up, then verify ALT contents/readiness.
4. Persist one immutable canonical binding: mint, launch slot, activation evidence, ALT references and readiness.
5. Vercel, transaction builder and rewards worker read the same database record and adopt it without env changes/redeploys/second activation toggles.
6. Rewards worker reconstructs actual native fees/windows from verified token launch slot even if entry lags ~60–120 seconds.
7. Repeating the same request is idempotent/recoverable. Different mint after canonical binding is rejected absent an explicit exceptional recovery procedure.

No `CHILD_LAUNCH_ENABLED`, `SIGNING_ENABLED`, `REWARDS_MODE=LIVE`, `BROADCAST=1` or equivalent manual choreography. Technical transaction prerequisites still gate an individual attempt; this is not a hidden feature switch. Child launches do not wait for native reward settlement to catch up.

---

## 10. Feed, activity, market data and metadata

### 10.1 SDK Feed

- One verified child launch → one idempotent authentic announcement with name/ticker, creator, SDK/version link, playable preview and **full token mint** (short display + one-click exact copy).
- Anonymous browsing; signed-in like/unlike and comments with rate limits and moderation.
- Latest / Trending / Most Used only when based on real evidence; otherwise honest chronological fallback.
- No general posting, DMs, follows or broad social network at MVP.
- A Feed failure cannot undo or stall an on-chain-verified token launch.

### 10.2 Market data and on-site usage

- Birdeye may provide price, MC, FDV, volume, liquidity, holders and charts **only when actually supported by the relevant token/pair**; label delay or unavailable data.
- Genuine SDK runs, successful executions, latency and consumer counts are **separate from trading metrics**.
- No invented trade data, provider fields or usage history.
- Verify Birdeye's exact custom-quote data coverage/latency and fallbacks before product-page implementation.

### 10.3 Token metadata

Pinata/IPFS for token artwork and metadata; specify validated image limits, MIME/type, immutable metadata address and failure/timeout policy. Use actual persisted IPFS CIDs in signed transactions. Token/pair state must be verifiable after submission.

---

## 11. Agentframe frontend foundation — dark-first

**Source archive:** `agentframe.zip`, containing 61 archive entries under `agentframe/`, including `app/`, `components/`, `public/`, `docs/design.md`, configuration and a package-lock.

**Inspected `package.json`:** `next: 16.3.4`, `react/react-dom: 19.2.8`, Tailwind **4.3.3** via PostCSS, strict TypeScript project, `motion`, `lucide-react`, `next-themes`. Template's Node engine is `>=20.9.0`. Before install/deployment, run security/compatibility review and seek approval before changing explicitly chosen template versions.

**User-confirmed licence:** template source may be committed to the public SDK repository. Preserve attribution/licence obligations where applicable.

**Visual direction:** **dark mode first**, restrained charcoal/grey, premium typography, subtle borders and motion; preserve Agentframe's existing design language rather than scaffold a second UI kit. Light mode is not an MVP priority.

**Candidate component reuse:** `hero`, `playground`, `nav`, `landscape-canvas`, `quickstart`, `run-journey`, `workspaces`, `product-story`, footer and theme primitives. Original template playground scenarios may be simulated; **replace those with actual SDK engine calls before presenting them as live**.

**Proposed route map (exact paths can be finalized during template adaptation):** `/`, `/build`, `/library`, `/sdk/[id]`, `/marketplace`, `/launch`, `/token/[mint]`, `/feed`, `/account`, `/rewards`, `/docs`, plus private operator pages. Do not leave misleading template-only pricing/subscription claims in published SDK pages.

**GitHub:** `https://github.com/bigbadman-lab/SDK` (public, initially empty at handover). **Do not modify before explicit final architecture approval.** MCPX reference: `https://github.com/bigbadman-lab/mock-align-hero`, for selected transaction/verification patterns only; do not wholesale port, and never copy tracked secrets.

---

## 12. Environment and operational security

**Supplied/expected provider stack:** Vercel, Supabase, Reown, OpenAI, Helius, Pinata, Birdeye, Pump official SDK, Render, NPM, GitHub. The handover says provider credentials were already prepared except transaction-builder URL/secret and an app session secret, with worker signer/key-management still to finalize. Do not request actual secret values in chat or print them in build logs.

- Vercel server secrets vs public `NEXT_PUBLIC_` values must be strictly separated.
- Render builder gets only credentials required for verified transaction construction; **not** native reward signer.
- Render rewards service gets financial key material and tightly limited DB permissions; **not** general-purpose Blueprint execution responsibilities.
- Server-side privileged Supabase access requires explicit application authorization; service keys never go client-side.
- Signing and provider credentials remain environment-managed; never commit `.env`, `.env.local`, secrets, full connection strings or leaked MCPX keys.
- Native custody signer format, rotation/backup/recovery and transaction policy **REQUIRES VERIFICATION** before real funds are entrusted.
- Do not introduce Redis/Upstash, a vector database, agent framework, alternative auth vendor, arbitrary hosted SDK backends or per-token workers absent concrete evidence of necessity.

---

## 13. Mandatory financial acceptance — exactly two mainnet rehearsals

These are the **two required financial end-to-end rehearsals**, not a sprawling mandatory test programme. Focused local tests support implementation; if a flow fails, fix and rerun the affected scenario. Production financial release is frozen after mainnet PASS.

### TEST 01 — Native holder rewards (disposable mainnet native token)

1. Create a disposable native token through the real relevant Pump path.
2. Generate genuine native creator fees using controlled low-value trading wallets.
3. Deliberately delay canonical mint activation by approximately **60–120 seconds**.
4. Prove correct UTC cutoff windows and historic wallet ownership/balance eligibility using the **current locked 50,000-token threshold applied to the disposable test native asset** (not the obsolete $20 threshold).
5. Prove source fee event coverage, actual fee collection, **30% SOL / 30% verified bought-back test-token quantity / 40% operations** with rounding accounted for.
6. Prove durable funded balances, real Claim All SOL+token transfers and finality evidence.
7. Exercise crash/unknown-transaction reconciliation for the affected financial path with focused controlled test conditions; no extra full rehearsal programme.

**PASS only with real signatures, verified vault/treasury/destination balances, correct cutoff accounting and claim receipts.** Operator recovery is separately development-tested and legally controlled; no live discretionary taking of user entitlements is implied by this test.

### TEST 02 — Child launch and dynamic SDK developer royalty (same disposable quote token)

1. Select an approved community SDK, including a separate trusted original developer wallet, with a verified functioning Blueprint.
2. Launch an actual child token with the disposable native token as its fixed quote, using the real wallet-signed builder, fee shares and ALT workflow.
3. Verify finalized creation mint, quote mint, immutable SDK-version binding, and exact royalty beneficiaries.
4. Generate real trades and verify collection/distribution and actual **quote token** ATA balances across **60/25/15** recipients (allow integer rounding).
5. Confirm real SDK playground execution, product registration, and automatically idempotent Feed announcement.
6. Record exact transaction/receipt evidence.

**PASS only with finalized chain receipts and correct actual payout assets and balances.**

---

## 14. Dependency map and implementation release gates

**Architecture approval precedes Cursor prompts.** No repo changes from this specification itself.

```text
Agentframe import + deployment baseline
               ↓
Wallet authentication + PostgreSQL ownership/session
               ↓
Blueprint Schema + six-operation Registry + Shared Engine
               ↓
Conversational Builder + real preview + usage guards
               ↓
Ten real official SDK **templates** + token-free community submission/review
               ↓
Verified token launch → automatic public SDK product publication + NPM integration + Feed
               ↓
Verified child token assembly + canonical mint dependency + royalties
               ↓
Token product pages + real market data + SDK Feed

Independent financial track, sharing canonical mint/config + DB only:
Canonical mint / Pump native fee configuration
               ↓
Finalized holder index + fee event source / collections
               ↓
Window allocation + actual buybacks + backed ledger
               ↓
Claims + operator recovery (implementation; legal limit on live recovery)
               ↓
Two mandatory mainnet rehearsals + financial freeze
```

**Key release gate:** Every public route and action must either work against the real runtime or be honestly inaccessible while unfinished. Public token-associated SDK publication is automatic upon verified launch; public template listing approval is a distinct token-free community process. A phase can be deployed without exposing inoperative unfinished features, but **no hidden launch-day on/off switches** for features represented as available. A genuine on-chain/network prerequisite may block a transaction and must be shown accurately.

---

## 15. Proposed Cursor development sequence — planning only, NOT prompts

Keep phases broad enough to produce real vertical slices with concise **PASS/BLOCKED** evidence. Avoid dozens of ceremony gates.

| Phase | Scope | Meaningful acceptance |
|---|---|---|
| **01 — Foundation + Agentframe** | Import licensed template; dark-first UX; safe configuration; DB foundation; Vercel deployment and strict TS | Existing design preserved; deployment works; no fake functional claims |
| **02 — Wallet identity** | Reown, nonce signature verification, secure session, wallet account and operator access | Sign in/out, wallet switch and permissions work end-to-end |
| **03 — Shared SDK Engine + Builder** | Blueprint v1, six operations, typed refs, quota/cost accounting, OpenAI+Helius, trace, real Builder preview | Natural-language build produces validated Blueprint and real executable output |
| **04 — Library + Marketplace + NPM foundation** | Ten fully working official reusable SDK templates, remix, token-free community build/test/submit/approve, provenance, universal client library/API foundation | All ten run real website trials; community developer submissions work without launching; client contract can be tested against shared engine but no unlaunched SDK is portrayed as a public token product |
| **05 — Token launch + royalties** | Render builder, canonical mint activation workflow, ALT, dynamic 60/25/15 Pump sharing, noncustodial launch, finalized verification and automatic public SDK product/API publication | Verified launch automatically creates pinned public SDK product/integration; real path works against disposable quote; no rewards dependency or launch flags |
| **06 — Product pages + Feed** | Complete the automatically published token SDK experience: Execution Inspector, generated docs, Birdeye data, verified launch posts and social interactions | Product software works and is integrable from verified launch; truthful metrics; Feed posts never fabricate success |
| **07 — Native financial worker** | Holder index, fee source, collection, five-minute windows, 30/30/40, buybacks, ledger, claims, private operator recovery | Backing and reconciliation demonstrable; financial signing isolated |
| **08 — Production acceptance** | Mainnet TEST 01/02, failure fixes, freeze validated financial release, final operational documentation | Both mandatory financial journeys PASS with receipts; single mint activation rehearsed |

**Dependency adjustment:** Implement/verify shared canonical-mint state and Pump fee-path feasibility sufficiently early that phases 05–07 do not discover impossible assumptions at the end. Rehearsals occur as soon as the corresponding vertical slices are ready, not necessarily postponed wholesale to Phase 08. Phase 08 is final verification and freeze, not a reason to conceal nonworking features in earlier phases.

---

## 16. Explicit verification register — do not silently assume PASS

| ID | Requirement to verify | Where evidence will come from | Blocking impact |
|---|---|---|---|
| V01 | Pump exact pinned SDK/API versions, custom-pair eligibility, quote token program constraints, creation+initial buy account layout | Official docs/current SDK and disposable mainnet launch | Child launch activation |
| V02 | Locked fee-share beneficiary setup timing, support for aggregated wallets, $SDK-denominated actual fee receipts and ATAs, graduated fees | Pump contracts + mainnet TEST 02 | Royalties/child launch correctness |
| V03 | Native creator-fee vault authority, fee event enumeration/attribution and collection across market states | Pump contracts + mainnet TEST 01 | Native reward settlement |
| V04 | Complete historical native-holder cutoff index and replay after activation delay or index interruption | Helius/RPC indexing and mainnet TEST 01 | Any holder reward credits |
| V05 | Real available buyback route, slippage bounds, exact net SDK received and custody | Pump real swaps + mainnet TEST 01 | Buyback-based SDK claimability |
| V06 | Treasury signer storage/isolation/rotation, unknown transaction recovery and available claim destination accounting | Service implementation checks + mainnet TEST 01 | Live native claims |
| V07 | ALT static/mint-dependent accounts, extension authorization, warm-up and transaction packet size | Solana program validation + mainnet TEST 02 | Canonical activation and child launches |
| V08 | Exact Blueprint validator schemas/modes, total AI cost ceilings and all ten acceptance examples | Type/schema tests + real SDK execution | Library public launch |
| V09 | NPM package identifier, versioned response/error contract, API authentication docs | Package/API specification and real external integration | Client publication |
| V10 | Market-data field support, refresh and unavailable states on custom quote tokens | Birdeye provider checks | Individual displayed market fields |
| V11 | Pinata upload, media/metadata size/type, metadata permanence and signing binding | Provider tests | Token metadata transaction readiness |
| V12 | Next/React/Tailwind install compatibility and security advisories (template versions pinned until reviewed) | Local audit/build + current advisories | Foundation deployment |
| V13 | Legally cleared live recovery right and accurate disclosures | Legal team approval and user's explicit publication authorization | **Real-entitlement recovery ONLY**; does not block building private action |
| V14 | No overlapping claim/recovery race and no duplicate transfer after unknown outcome | Financial ledger constraints + controlled transaction reconciliation | Live claims and recovery |
| V15 | Durable launch verification invocation independent of browser and native rewards | Operational test/restart evidence | Reliable child launch registration |

**Note:** These are verification tasks inside the approved implementation and two financial rehearsals, not fifteen new mainnet rehearsal gates. Item V13 is a legal/activation dependency distinct from technical feature construction.

---

## 17. Confirmed exclusions from MVP

No arbitrary executable third-party SDK code, external hosted API integrations as arbitrary operation, uploaded scripts, separate per-token NPM packages, per-SDK workers, autonomous agents/trading, unlimited cron execution, long-lived product-side bots, multi-author royalty graphs, general-purpose social networks, DMs/follows, competing AI-provider routing, vector database, unnecessary Redis or message broker, fake launch switches, pretend simulation results or unverified financial balances.

---

## 18. Final architecture approval checkpoint

This file **records decisions already approved** in the conversation but its consolidation and implementation phase sequence still require **explicit final user approval**.

**Before first Cursor `.md` prompt:**

- [ ] User approves this consolidated specification as SDK's authoritative master architecture.
- [ ] Known blocking contradictions are reconciled (not invented away).
- [ ] Agentframe import approach/version/security review is stated in first foundation phase.
- [ ] Implementation phase sequence and vertical-slice PASS/BLOCKED reporting are accepted.
- [ ] Financial verification register stays visible and no unverified Pump/Helius behaviour is presented as proven.
- [ ] Repository remains untouched until authorized.

**Upon approval:** Produce **one precise, scoped Cursor `.md` prompt for Phase 01**, with explicit acceptance criteria, honest PASS/BLOCKED response and no secrets printed. Subsequent phases are prompted only when appropriately ready.

**Guiding rule:** Build → Test → Launch automatically publishes a real token-associated SDK product; community developer submissions remain token-free reusable library entries. Ambitious and genuinely functional for users; operationally boring underneath. One shared execution engine, real data, immutable provenance, verified money movement, one canonical mint activation and no MCPX-style launch-day toggles.

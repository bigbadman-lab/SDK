import { createHash } from "node:crypto";

import type { Blueprint, DeclarativeSchema, InputField, Operation, ResponseSchema, Step } from "../blueprint/model.ts";
import { OFFICIAL_SDK_NAMES } from "./library.ts";

export const OFFICIAL_ORIGINATOR_LABEL = "SDK";
export const OFFICIAL_NAMESPACE = "a3f1c8e0-4b27-4d6a-9c15-8e2d7b6a1f04";

const LIMITS = { timeoutMs: 60_000, maxOutputBytes: 131_072 } as const;
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export type OfficialInputGuide = { help: string; example: string };

export type OfficialSdk = {
  id: string;
  name: (typeof OFFICIAL_SDK_NAMES)[number];
  description: string;
  blueprint: Blueprint;
  guide: Record<string, OfficialInputGuide>;
  sample: Record<string, string>;
};

export function uuidV5(name: string, namespace = OFFICIAL_NAMESPACE): string {
  const hash = createHash("sha1")
    .update(Buffer.concat([uuidBytes(namespace), Buffer.from(name, "utf8")]))
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  const version = bytes[6] ?? 0;
  const variant = bytes[8] ?? 0;
  bytes[6] = (version & 0x0f) | 0x50;
  bytes[8] = (variant & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function officialSdkId(name: string): string {
  return uuidV5(`sdk.official.${name}`);
}

export function officialInputGuide(name: string): Record<string, OfficialInputGuide> | null {
  return OFFICIAL_SDKS.find((sdk) => sdk.name === name)?.guide ?? null;
}

export function officialSeedPlan(input: {
  existing: { id: string; contentHash: string | null } | null;
  sdk: { id: string; contentHash: string };
}):
  | { action: "create" }
  | { action: "reuse" }
  | { action: "attach" }
  | { action: "reject"; code: "official_id" | "official_changed" } {
  if (!input.existing) return { action: "create" };
  if (input.existing.id !== input.sdk.id) return { action: "reject", code: "official_id" };
  if (!input.existing.contentHash) return { action: "attach" };
  if (input.existing.contentHash === input.sdk.contentHash) return { action: "reuse" };
  return { action: "reject", code: "official_changed" };
}

export const OFFICIAL_SDKS: readonly OfficialSdk[] = [
  define({
    name: "Prompt Architect",
    description:
      "Turns a rough instruction into a clearer prompt, explains the important changes, and suggests a few variations.",
    inputs: {
      original_prompt: guide(
        "The instruction you want rewritten.",
        "write a tweet about wallets",
        { required: true, maxLength: 4_000 },
      ),
      objective: guide("What the finished prompt should achieve.", "Explain one idea to a general reader.", {
        required: true,
        maxLength: 1_000,
      }),
      audience: guide("Who will use the prompt or read the result.", "A non-technical reader", {
        required: true,
        maxLength: 500,
      }),
      output_format: guide("The shape of the answer the prompt should request.", "One short paragraph", {
        required: true,
        maxLength: 500,
      }),
    },
    steps: [
      ai("rewrite", "ai.generate", "prompt_result_v1", {
        original_prompt: ref("inputs.original_prompt"),
        objective: ref("inputs.objective"),
        audience: ref("inputs.audience"),
        output_format: ref("inputs.output_format"),
      }, "Rewrite the original prompt so it states the objective, audience, and output format. Put the rewritten prompt in improved. Use notes for the important changes and for two or three variations. Do not claim the prompt was tested."),
    ],
    outputs: { prompt: whole("rewrite") },
    sample: {
      original_prompt: "write a tweet about wallets",
      objective: "Explain one idea to a general reader.",
      audience: "A non-technical reader",
      output_format: "One short paragraph",
    },
  }),
  define({
    name: "Data Alchemist",
    description:
      "Turns unstructured text into structured JSON text, lists fields that were not in the source, and notes how the extraction was made. It does not invent missing values.",
    inputs: {
      raw_text: guide("The source text. Only values in this text may be extracted.", "Ada joined on Monday. Her city was not provided.", {
        required: true,
        maxLength: 8_000,
      }),
      structure: guide(
        "The fields you want, in your own words.",
        "name, start day, city",
        { required: true, maxLength: 2_000 },
      ),
      instructions: guide("Optional rules for the extraction. Leave this blank if you have none.", "", {
        required: false,
        maxLength: 2_000,
      }),
    },
    steps: [
      ai(
        "extract",
        "ai.generate",
        fields(["structured_json", "missing_fields", "extraction_notes"]),
        {
          raw_text: ref("inputs.raw_text"),
          structure: ref("inputs.structure"),
          instructions: ref("inputs.instructions"),
        },
        "Extract only values that appear in the source text. Put a JSON object, encoded as text, in structured_json. If a requested field is absent, omit its value and list the field name in missing_fields. Do not invent values, counts, dates, or names. Use extraction_notes to say what was copied and what was missing.",
      ),
    ],
    outputs: { extraction: whole("extract") },
    sample: {
      raw_text: "Ada joined on Monday. Her city was not provided.",
      structure: "name, start day, city",
      instructions: "Copy only words that are in the source.",
    },
  }),
  define({
    name: "Document Intelligence",
    description:
      "Summarises pasted text, then lists entities, findings, risks, and short excerpts from that text. It does not read an uploaded file.",
    inputs: {
      document_text: guide(
        "Paste the text to analyse. This SDK does not open a PDF or another file.",
        "The pilot runs for six weeks. The budget is not stated. Contact is Mina.",
        { required: true, maxLength: 8_000 },
      ),
      objective: guide("What you want to learn from the text.", "Identify the facts, gaps, and people.", {
        required: true,
        maxLength: 1_000,
      }),
    },
    steps: [
      ai(
        "review",
        "ai.analyze",
        fields(["summary", "entities", "findings", "risks", "excerpts"]),
        {
          document_text: ref("inputs.document_text"),
          objective: ref("inputs.objective"),
        },
        "Analyse only the pasted document text. Do not claim that a file, PDF, or external page was read. Put a short summary in summary, entities and facts in entities, the main findings in findings, risks and uncertainties in risks, and short supporting excerpts from the pasted text in excerpts. If the text does not support a point, say that it is not in the text.",
      ),
    ],
    outputs: { analysis: whole("review") },
    sample: {
      document_text: "The pilot runs for six weeks. The budget is not stated. Contact is Mina.",
      objective: "Identify the facts, gaps, and people.",
    },
  }),
  define({
    name: "World Engine",
    description: "Builds a fictional world from a concept, including places, factions, rules, and story conflicts.",
    inputs: {
      concept: guide("The seed of the world.", "A city built on a frozen harbour.", { required: true, maxLength: 2_000 }),
      genre: guide("The kind of story this world belongs to.", "Science fiction", { required: true, maxLength: 200 }),
      tone: guide("How the world should feel.", "Quiet and uneasy", { required: true, maxLength: 200 }),
      constraints: guide("Limits the world should respect. Leave this blank if you have none.", "No magic.", {
        required: false,
        maxLength: 1_000,
      }),
    },
    steps: [
      ai(
        "compose",
        "ai.generate",
        fields(["overview", "geography", "factions", "rules", "hooks"]),
        {
          concept: ref("inputs.concept"),
          genre: ref("inputs.genre"),
          tone: ref("inputs.tone"),
          constraints: ref("inputs.constraints"),
        },
        "Create a fictional world from the concept, genre, tone, and constraints. Put the overview in overview, places in geography, groups in factions, setting rules in rules, and conflicts or story hooks in hooks. This is fiction.",
      ),
    ],
    outputs: { world: whole("compose") },
    sample: {
      concept: "A city built on a frozen harbour.",
      genre: "Science fiction",
      tone: "Quiet and uneasy",
      constraints: "No magic.",
    },
  }),
  define({
    name: "PersonaOS",
    description:
      "Replies as a defined persona using the current message and a bounded history you supply. It keeps no memory beyond that input.",
    inputs: {
      persona: guide("Who is speaking, including stable traits and limits.", "A calm librarian who answers in two sentences.", {
        required: true,
        maxLength: 2_000,
      }),
      user_message: guide("The message the persona should answer.", "What should I read next?", {
        required: true,
        maxLength: 4_000,
      }),
      history: guide(
        "Earlier turns, if you have them. Use an empty value when this is the first message. Nothing is stored after the run.",
        "",
        { required: false, maxLength: 8_000 },
      ),
    },
    steps: [
      ai(
        "reply",
        "ai.generate",
        fields(["response", "traits", "conversation_metadata"]),
        {
          persona: ref("inputs.persona"),
          user_message: ref("inputs.user_message"),
          history: ref("inputs.history"),
        },
        "Reply only as the defined persona. Use the user message and the supplied history, which may be empty. Do not claim memory beyond that history. Put the reply in response, stable traits in traits, and a short note of this turn in conversation_metadata.",
      ),
    ],
    outputs: { persona: whole("reply") },
    sample: {
      persona: "A calm librarian who answers in two sentences.",
      user_message: "What should I read next?",
      history: "",
    },
  }),
  define({
    name: "Decision Lab",
    description:
      "Compares options against stated priorities, including trade-offs, risks, and a recommendation. It does not invent probabilities.",
    inputs: {
      problem: guide("The decision to make.", "Choose a first release for a small team.", { required: true, maxLength: 2_000 }),
      options: guide("The choices, written out by you.", "Ship a narrow tool. Wait for a broader product.", {
        required: true,
        maxLength: 4_000,
      }),
      priorities: guide("What matters, and any constraints.", "Learn quickly. Avoid a large build.", {
        required: true,
        maxLength: 2_000,
      }),
    },
    steps: [
      ai(
        "compare",
        "ai.analyze",
        fields(["option_analysis", "tradeoffs", "risks", "framework", "recommendation", "uncertainty"]),
        {
          problem: ref("inputs.problem"),
          options: ref("inputs.options"),
          priorities: ref("inputs.priorities"),
        },
        "Compare the options against the stated priorities. Put the option-by-option analysis in option_analysis, trade-offs in tradeoffs, risks in risks, the comparison frame in framework, and a recommendation in recommendation. Use uncertainty to state what is not known. Do not assign probabilities or claim certainty when the inputs do not support it.",
      ),
    ],
    outputs: { decision: whole("compare") },
    sample: {
      problem: "Choose a first release for a small team.",
      options: "Ship a narrow tool. Wait for a broader product.",
      priorities: "Learn quickly. Avoid a large build.",
    },
  }),
  define({
    name: "Chain Investigator",
    description: "Reads a bounded sample of recent Solana signatures for an address and summarises only what that sample shows.",
    inputs: {
      wallet: guide(
        "The Solana address to inspect. The example is the System Program, a real account.",
        SYSTEM_PROGRAM,
        { kind: "address" },
      ),
      objective: guide("What you want to know from the recent signatures.", "Describe the latest signatures and their limits.", {
        required: true,
        maxLength: 1_000,
      }),
    },
    steps: [
      chain("read_activity", { mode: "recent", limit: 5 }, { address: ref("inputs.wallet") }),
      ai(
        "explain",
        "ai.analyze",
        fields(["evidence", "patterns", "references", "limitations"]),
        {
          wallet: ref("inputs.wallet"),
          objective: ref("inputs.objective"),
          activity: ref("steps.read_activity.result"),
        },
        "Use only the supplied signature sample. Describe what the signatures show in evidence, repeating patterns in patterns, and signature or slot references in references. In limitations, state that this is a bounded recent sample, that transfer amounts are not included, and that ownership or coordination cannot be inferred. Do not invent balances, counterparties, or motives.",
      ),
    ],
    outputs: { activity: whole("read_activity"), report: whole("explain") },
    sample: {
      wallet: SYSTEM_PROGRAM,
      objective: "Describe the latest signatures and their limits.",
    },
  }),
  define({
    name: "Token Forensics",
    description:
      "Reads a Solana mint account and reports the supply, decimals, and authority fields that are present. It does not score the token.",
    inputs: {
      mint: guide("The mint address. The example is the USDC mint.", USDC_MINT, { kind: "address" }),
    },
    steps: [
      token("read_mint", { mode: "mint" }, { mint: ref("inputs.mint") }),
      ai(
        "explain",
        "ai.analyze",
        fields(["mint_facts", "authorities", "concerns", "unknowns"]),
        {
          mint: ref("inputs.mint"),
          account: ref("steps.read_mint.result"),
        },
        "Use only the supplied mint account summary. Report decimals, supply, name, symbol, and any mint or freeze authority that is present in mint_facts. Put authority evidence in authorities. Put a concern in concerns only when a present field supports it. Do not assign a risk score or call the token safe, fraudulent, or malicious. Put every absent field in unknowns.",
      ),
    ],
    outputs: { mint: whole("read_mint"), report: whole("explain") },
    sample: { mint: USDC_MINT },
  }),
  define({
    name: "Wallet DNA",
    description: "Reads an address balance and recent signatures, then separates those on-chain facts from a creative persona.",
    inputs: {
      wallet: guide(
        "The Solana address to characterise. The example is the System Program, a real account.",
        SYSTEM_PROGRAM,
        { kind: "address" },
      ),
    },
    steps: [
      account("read_balances", { mode: "balances" }, { address: ref("inputs.wallet") }),
      chain("read_activity", { mode: "recent", limit: 5 }, { address: ref("inputs.wallet") }),
      ai(
        "explain",
        "ai.generate",
        fields(["activity_summary", "on_chain_facts", "persona", "observations", "limitations"]),
        {
          wallet: ref("inputs.wallet"),
          balances: ref("steps.read_balances.result"),
          activity: ref("steps.read_activity.result"),
        },
        "Separate facts from interpretation. Use tokenAccountCount for the number of token accounts in the sample, and call them token accounts rather than balances. If truncated is true, say the sample is incomplete. Put what the balance and signature sample show in activity_summary and on_chain_facts. Put a readable characterisation in persona and start that field with Interpretation. Put supporting observations in observations. In limitations, state the sample size and that token amounts and transfer values are not in this sample.",
      ),
    ],
    outputs: {
      balances: whole("read_balances"),
      activity: whole("read_activity"),
      report: whole("explain"),
    },
    sample: { wallet: SYSTEM_PROGRAM },
  }),
  define({
    name: "Venture Forge",
    description:
      "Turns an idea into a concept, audience, MVP, model, risks, and next steps. Market statements are assumptions, not verified research.",
    inputs: {
      idea: guide("The starting idea.", "A shared notebook for a research group.", { required: true, maxLength: 2_000 }),
      audience: guide("Who it is for.", "Small university labs", { required: true, maxLength: 500 }),
      market: guide("The industry or setting, as you understand it.", "Research tools", { required: true, maxLength: 500 }),
      constraints: guide("Limits on time, money, or scope. Leave this blank if you have none.", "Two people and one month.", {
        required: false,
        maxLength: 1_000,
      }),
    },
    steps: [
      ai(
        "shape",
        "ai.generate",
        fields(["concept", "value_proposition", "customers", "mvp", "business_model", "risks", "next_steps"]),
        {
          idea: ref("inputs.idea"),
          audience: ref("inputs.audience"),
          market: ref("inputs.market"),
          constraints: ref("inputs.constraints"),
        },
        "Turn the idea into a structured concept. Fill concept, value_proposition, customers, mvp, business_model, risks, and next_steps. Begin customers, business_model, and any market statement with Assumption:. Do not present them as verified research or as evidence of demand.",
      ),
    ],
    outputs: { venture: whole("shape") },
    sample: {
      idea: "A shared notebook for a research group.",
      audience: "Small university labs",
      market: "Research tools",
      constraints: "Two people and one month.",
    },
  }),
];

function define(input: {
  name: OfficialSdk["name"];
  description: string;
  inputs: Record<string, { field: InputField; guide: OfficialInputGuide }>;
  steps: Step[];
  outputs: Blueprint["outputs"];
  sample: Record<string, string>;
}): OfficialSdk {
  const inputs: Blueprint["inputs"] = {};
  const guide: Record<string, OfficialInputGuide> = {};
  for (const [key, value] of Object.entries(input.inputs)) {
    inputs[key] = value.field;
    guide[key] = value.guide;
  }
  const capabilities = [...new Set(input.steps.map((step) => step.op))] as Operation[];
  return {
    id: officialSdkId(input.name),
    name: input.name,
    description: input.description,
    blueprint: {
      schemaVersion: "1.0",
      name: input.name,
      description: input.description,
      inputs,
      steps: input.steps,
      outputs: input.outputs,
      limits: { timeoutMs: LIMITS.timeoutMs, maxOutputBytes: LIMITS.maxOutputBytes },
      capabilities,
    },
    guide,
    sample: input.sample,
  };
}

function guide(
  help: string,
  example: string,
  field: { required: boolean; maxLength: number } | { kind: "address" },
): { field: InputField; guide: OfficialInputGuide } {
  return {
    field: "kind" in field ? { type: "solanaAddress", required: true } : { type: "string", required: field.required, maxLength: field.maxLength },
    guide: { help, example },
  };
}

function fields(keys: string[]): DeclarativeSchema {
  return {
    type: "object",
    properties: Object.fromEntries(keys.map((key) => [key, { type: "string" as const }])),
    required: keys,
  };
}

function ai(
  id: string,
  op: "ai.generate" | "ai.analyze",
  schema: ResponseSchema,
  args: Step["args"],
  task: string,
): Step {
  return { id, op, config: { task, responseSchema: schema }, args };
}

function chain(id: string, config: { mode: "recent"; limit: number }, args: Step["args"]): Step {
  return { id, op: "solana.transactions", config, args };
}

function token(id: string, config: { mode: "mint" }, args: Step["args"]): Step {
  return { id, op: "solana.token", config, args };
}

function account(id: string, config: { mode: "balances" }, args: Step["args"]): Step {
  return { id, op: "solana.account", config, args };
}

function ref(path: string): { $ref: string } {
  return { $ref: path };
}

function whole(stepId: string): Blueprint["outputs"][string] {
  return { type: "object", from: { $ref: `steps.${stepId}.result` } };
}

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ""), "hex");
}

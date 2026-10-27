import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { OPERATIONS } from "../blueprint/model.ts";
import { BUILDER_EXAMPLES, insertedExamplePrompt, type BuilderExample } from "./examples.ts";

const GENERATE = new Set(["writing-assistant"]);
const ANALYZE = new Set(["document-summariser", "decision-assistant", "feedback-classifier"]);
const SOLANA = new Set(["wallet-analyser", "token-information"]);

test("six shared builder examples have unique ids, labels, and full prompts", () => {
  assert.equal(BUILDER_EXAMPLES.length, 6);
  const ids = BUILDER_EXAMPLES.map((example) => example.id);
  const labels = BUILDER_EXAMPLES.map((example) => example.label);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(labels).size, labels.length);
  for (const example of BUILDER_EXAMPLES) {
    assert.equal(example.id.trim().length > 0, true);
    assert.equal(example.label.trim().length > 0, true);
    assert.equal(example.prompt.trim().length > example.label.length, true);
    assert.equal(insertedExamplePrompt(example), example.prompt);
    assert.equal(example.prompt === example.label, false);
  }
});

test("the homepage and builder import the shared examples and insert prompts without sending", () => {
  const home = readFileSync(new URL("../../components/builder/home-prompt.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../../components/builder/panel.tsx", import.meta.url), "utf8");
  for (const source of [home, panel]) {
    assert.match(source, /import \{ BUILDER_EXAMPLES \} from "@\/lib\/builder\/examples"/);
    assert.equal(source.includes("const EXAMPLES"), false);
    assert.match(source, /onClick=\{\(\) => setText\(example\.prompt\)\}/);
    assert.match(source, /\{example\.label\}/);
    const chip = source.slice(source.indexOf("BUILDER_EXAMPLES.map"), source.indexOf("BUILDER_EXAMPLES.map") + 700);
    assert.match(chip, /type="button"/);
    assert.equal(chip.includes("submit("), false);
    assert.equal(chip.includes("submitMessage"), false);
  }
  assert.match(panel, /messages\.length === 0/);
});

test("generation, analysis, and Solana examples stay inside the conversational compiler", () => {
  const byId = new Map(BUILDER_EXAMPLES.map((example) => [example.id, example]));
  assert.deepEqual([...GENERATE, ...ANALYZE, ...SOLANA].sort(), [...byId.keys()].sort());
  for (const id of GENERATE) {
    const example = required(byId, id);
    assert.match(example.prompt, /one ai\.generate step/);
    assert.match(example.prompt, /text field/);
    assert.equal(example.prompt.includes("ai.analyze"), false);
  }
  for (const id of ANALYZE) {
    const example = required(byId, id);
    assert.match(example.prompt, /one ai\.analyze step/);
    assert.match(example.prompt, /summary/);
    assert.match(example.prompt, /findings/);
  }
  const wallet = required(byId, "wallet-analyser");
  assert.match(wallet.prompt, /solanaAddress/);
  assert.match(wallet.prompt, /Do not infer wallet ownership or sign transactions/);
  const token = required(byId, "token-information");
  assert.match(token.prompt, /solana\.token in mint mode/);
  assert.match(token.prompt, /Do not invent token risk scores or safety claims/);
  for (const example of BUILDER_EXAMPLES) {
    for (const operation of mentionedOperations(example.prompt)) {
      assert.equal(OPERATIONS.includes(operation), true);
    }
    assert.equal(/sendTransaction|trading|database|PDF|https?:\/\//i.test(example.prompt), false);
  }
});

function required(examples: Map<string, BuilderExample>, id: string): BuilderExample {
  const example = examples.get(id);
  assert.ok(example);
  return example;
}

function mentionedOperations(prompt: string): Array<(typeof OPERATIONS)[number]> {
  return OPERATIONS.filter((operation) => prompt.includes(operation));
}

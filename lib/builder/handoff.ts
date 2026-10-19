import { MAX_BUILDER_MESSAGE_CHARS } from "../blueprint/model.ts";

export const HANDOFF_KEY = "sdk.builder.handoff";
export const HANDOFF_TTL_MS = 120_000;

export type Handoff = {
  id: string;
  prompt: string;
  createdAt: number;
};

export type HandoffStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

type Generation<T> = {
  id: string;
  prompt: string;
  promise: Promise<T>;
};

let generation: Generation<unknown> | null = null;
const stageListeners = new Set<(stage: "understanding" | "constructing" | "validating" | "ready") => void>();

export function subscribeBuildStage(
  listener: (stage: "understanding" | "constructing" | "validating" | "ready") => void,
): () => void {
  stageListeners.add(listener);
  return () => {
    stageListeners.delete(listener);
  };
}

export function emitBuildStage(stage: "understanding" | "constructing" | "validating" | "ready"): void {
  for (const listener of stageListeners) listener(stage);
}

export function homepageSend(input: { authenticated: boolean; prompt: string }): "sign_in" | "build" | "empty" {
  if (input.prompt.trim().length < 1) return "empty";
  if (!input.authenticated) return "sign_in";
  return "build";
}

export function builderPath(): "/build" {
  return "/build";
}

export function createHandoff(prompt: string, now = Date.now(), id = crypto.randomUUID()): Handoff | null {
  const text = prompt.trim();
  if (text.length < 1 || text.length > MAX_BUILDER_MESSAGE_CHARS) return null;
  return { id, prompt: text, createdAt: now };
}

export function storeHandoff(storage: HandoffStorage, handoff: Handoff): void {
  storage.setItem(HANDOFF_KEY, JSON.stringify({ id: handoff.id, prompt: handoff.prompt, createdAt: handoff.createdAt }));
}

export function readHandoff(raw: string | null, now = Date.now(), maxAgeMs = HANDOFF_TTL_MS): Handoff | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Handoff>;
    if (typeof value.id !== "string" || typeof value.prompt !== "string" || typeof value.createdAt !== "number") {
      return null;
    }
    if (!Number.isFinite(value.createdAt) || value.createdAt > now + 5_000) return null;
    if (now - value.createdAt > maxAgeMs) return null;
    const prompt = value.prompt.trim();
    if (prompt.length < 1 || prompt.length > MAX_BUILDER_MESSAGE_CHARS) return null;
    return { id: value.id, prompt, createdAt: value.createdAt };
  } catch {
    return null;
  }
}

export function beginGeneration<T>(
  storage: HandoffStorage,
  run: (prompt: string) => Promise<T>,
  now = Date.now(),
): Generation<T> | null {
  if (generation) return generation as Generation<T>;
  const handoff = readHandoff(storage.getItem(HANDOFF_KEY), now);
  if (!handoff) {
    if (storage.getItem(HANDOFF_KEY)) storage.removeItem(HANDOFF_KEY);
    return null;
  }
  storage.removeItem(HANDOFF_KEY);
  const next: Generation<T> = { id: handoff.id, prompt: handoff.prompt, promise: run(handoff.prompt) };
  generation = next;
  return next;
}

export function settleGeneration(id: string): void {
  if (generation?.id === id) generation = null;
}

export function resetGenerationState(): void {
  generation = null;
  stageListeners.clear();
}

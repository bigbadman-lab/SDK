export const LIBRARY_VOTE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function libraryVoteDecision(input: {
  now: number;
  lastVoteAt: number | null;
}): { action: "cast" } | { action: "wait"; retryAt: number } {
  if (input.lastVoteAt === null || !Number.isFinite(input.lastVoteAt)) return { action: "cast" };
  const retryAt = input.lastVoteAt + LIBRARY_VOTE_WINDOW_MS;
  if (Number.isFinite(input.now) && input.now >= retryAt) return { action: "cast" };
  return { action: "wait", retryAt };
}

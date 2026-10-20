export type LaunchPageMode =
  "choose" | "conflict" | "private-sign-in" | "public-hold" | "resolve";

export function launchPageMode(input: {
  signedIn: boolean;
  draftId?: string | null;
  librarySdkId?: string | null;
}): LaunchPageMode {
  const draft = input.draftId?.trim() || null;
  const library = input.librarySdkId?.trim() || null;
  if (draft && library) return "conflict";
  if (!draft && !library) return "choose";
  if (!input.signedIn) return draft ? "private-sign-in" : "public-hold";
  return "resolve";
}

export function launchCatalogHref(query: { q: string; page: number; rehearsal?: boolean }): string {
  const params = new URLSearchParams();
  if (query.rehearsal) params.set("rehearsal", "trest");
  if (query.q) params.set("q", query.q);
  if (query.page > 1) params.set("page", String(query.page));
  const text = params.toString();
  return text.length > 0 ? `/launch?${text}` : "/launch";
}

export function launchDraftHref(draftId: string, rehearsal = false): string {
  const params = new URLSearchParams({ draft: draftId });
  if (rehearsal) params.set("rehearsal", "trest");
  return `/launch?${params.toString()}`;
}

export function launchLibraryHref(sdkId: string, versionId: string, rehearsal = false): string {
  const params = new URLSearchParams({ library: sdkId, version: versionId });
  if (rehearsal) params.set("rehearsal", "trest");
  return `/launch?${params.toString()}`;
}

export function isLaunchEligibleDraft(draft: {
  tested: boolean;
  versionId: string | null;
  contentHash: string | null;
}): boolean {
  return draft.tested && Boolean(draft.versionId) && Boolean(draft.contentHash);
}

export function matchesSdkQuery(
  sdk: { name: string; description: string },
  q: string
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    sdk.name.toLowerCase().includes(needle) ||
    sdk.description.toLowerCase().includes(needle)
  );
}

const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;

export function parseSdkIdentity(
  name: string,
  description: string
):
  | { ok: true; name: string; description: string }
  | { ok: false; code: "name" | "description" } {
  const cleanName = name.trim().replace(/\s+/g, " ");
  const cleanDescription = description.trim();
  if (cleanName.length < 1 || cleanName.length > NAME_MAX)
    return { ok: false, code: "name" };
  if (
    cleanDescription.length < 1 ||
    cleanDescription.length > DESCRIPTION_MAX
  ) {
    return { ok: false, code: "description" };
  }
  return { ok: true, name: cleanName, description: cleanDescription };
}

export function saveAllowed(
  currentHash: string,
  successfulHash: string | null
): boolean {
  return (
    successfulHash !== null &&
    currentHash.length > 0 &&
    successfulHash === currentHash
  );
}

const DRAFT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isListedSdk(
  savedAt: string | null,
  deletedAt: string | null = null
): boolean {
  return savedAt !== null && deletedAt === null;
}

export function accountDestination(draftId: string): string {
  return `/account?sdk=${encodeURIComponent(draftId)}&saved=1`;
}

export function shouldRedirectAfterSave(result: {
  ok: boolean;
  draftId?: string | null;
  saved?: boolean;
}): boolean {
  return (
    result.ok === true &&
    result.saved === true &&
    typeof result.draftId === "string" &&
    DRAFT_ID.test(result.draftId)
  );
}

export function launchAction(input: { sdkId: string; tested: boolean }): {
  sdkId: string;
  href: string | null;
  label: "Prepare launch" | "Test before launch";
} {
  if (!input.tested)
    return { sdkId: input.sdkId, href: null, label: "Test before launch" };
  return {
    sdkId: input.sdkId,
    href: `/launch?draft=${encodeURIComponent(input.sdkId)}`,
    label: "Prepare launch",
  };
}

export function deleteDecision(
  row: { owner: boolean; saved: boolean; deleted: boolean } | null
): "delete" | "already_deleted" | "reject" {
  if (!row?.owner || !row.saved) return "reject";
  if (row.deleted) return "already_deleted";
  return "delete";
}

export function isSameSavedIdentity(
  current: {
    savedHash: string | null;
    savedName: string | null;
    savedDescription: string | null;
  },
  next: { hash: string; name: string; description: string }
): boolean {
  return (
    current.savedHash === next.hash &&
    current.savedName === next.name &&
    current.savedDescription === next.description
  );
}

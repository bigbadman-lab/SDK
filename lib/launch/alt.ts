export const ALT_AUTHORITY = "DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC";
export const PACKET_LIMIT_BYTES = 1232;
export const LOOKUP_TABLE_META_BYTES = 56;

export function selectStaticAltMembers(input: {
  referenced: readonly string[];
  signers: readonly string[];
  knownStatic: readonly string[];
}): string[] {
  const signers = new Set(input.signers);
  const known = new Set(input.knownStatic);
  const selected = new Set<string>();
  for (const address of input.referenced) {
    if (known.has(address) && !signers.has(address)) selected.add(address);
  }
  return [...selected].sort();
}

export function altWarmth(input: {
  exists: boolean;
  authority: string | null;
  expectedAuthority: string;
  lastExtendedSlot: number;
  currentSlot: number;
  addresses: readonly string[];
  required: readonly string[];
}): "absent" | "authority" | "incomplete" | "warming" | "warm" {
  if (!input.exists) return "absent";
  if (input.authority !== input.expectedAuthority) return "authority";
  const present = new Set(input.addresses);
  if (input.required.some((address) => !present.has(address))) return "incomplete";
  if (!(input.currentSlot > input.lastExtendedSlot)) return "warming";
  return "warm";
}

export function lookupTableBytes(addressCount: number): number {
  return LOOKUP_TABLE_META_BYTES + 32 * addressCount;
}

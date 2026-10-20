export type GateStatus = "PASS" | "PARTIAL" | "BLOCKED";

export type GateEvidence = {
  fixture: boolean;
  readOnlyMainnet: boolean;
  signed: boolean;
  confirmed: boolean;
};

export function financialGate(evidence: GateEvidence): GateStatus {
  if (evidence.confirmed && evidence.signed) return "PASS";
  if (evidence.readOnlyMainnet || evidence.signed) return "PARTIAL";
  return "BLOCKED";
}

export function infrastructureGate(input: { servicesHealthy: boolean; schemaCurrent: boolean; recoveryTested: boolean }): GateStatus {
  if (input.servicesHealthy && input.schemaCurrent && input.recoveryTested) return "PASS";
  if (input.servicesHealthy || input.schemaCurrent) return "PARTIAL";
  return "BLOCKED";
}

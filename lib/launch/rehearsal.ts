export type RehearsalInput = {
  registered: boolean;
  observationOk: boolean;
  builderReady: boolean;
  migrationsApplied: boolean;
  simulationPassed: boolean;
  operatorAuthorised: boolean;
};

export type RehearsalGate = {
  executes: boolean;
  missing: string[];
};

const CHECKS: { key: keyof RehearsalInput; label: string }[] = [
  { key: "registered", label: "TREST mint registered" },
  { key: "observationOk", label: "on-chain parent verification" },
  { key: "builderReady", label: "builder accepts TREST as the custom quote" },
  { key: "migrationsApplied", label: "launch and rewards migrations applied" },
  { key: "simulationPassed", label: "live preflight simulation" },
  { key: "operatorAuthorised", label: "operator authorises the rehearsal" },
];

export function rehearsalGate(input: RehearsalInput): RehearsalGate {
  const missing = CHECKS.filter((check) => input[check.key] !== true).map((check) => check.label);
  return { executes: missing.length === 0, missing };
}

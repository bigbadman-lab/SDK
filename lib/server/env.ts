import "server-only";

const PUBLIC_ENV_NAMES = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SOLANA_NETWORK",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_REOWN_PROJECT_ID",
] as const;

const SECRET_ENV_NAMES = [
  "APP_SESSION_SECRET",
  "SUPABASE_SECRET_KEY",
  "DATABASE_URL",
  "OPENAI_API_KEY",
  "HELIUS_API_KEY",
  "HELIUS_RPC_URL",
  "BIRDEYE_API_KEY",
  "PINATA_JWT",
  "PINATA_GATEWAY_DOMAIN",
  "TX_BUILDER_URL",
  "TX_BUILDER_SECRET",
  "OPERATOR_WALLET_ADDRESS",
  "API_KEY_PEPPER",
] as const;

export type PublicEnvName = (typeof PUBLIC_ENV_NAMES)[number];
export type SecretEnvName = (typeof SECRET_ENV_NAMES)[number];
export type EnvName = PublicEnvName | SecretEnvName;

export const recognizedPublicEnvNames: readonly PublicEnvName[] =
  PUBLIC_ENV_NAMES;
export const recognizedSecretEnvNames: readonly SecretEnvName[] =
  SECRET_ENV_NAMES;

function read(name: EnvName): string | undefined {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readOptionalEnv(name: EnvName): string | undefined {
  return read(name);
}

export function requireEnv(name: EnvName): string {
  const value = read(name);
  if (!value) {
    throw new Error(`Missing required server configuration: ${name}`);
  }
  return value;
}

export function requireSessionSecret(): string {
  return requireEnv("APP_SESSION_SECRET");
}

export function requireApiKeyPepper(): string {
  const value = requireEnv("API_KEY_PEPPER");
  if (value.length < 32) {
    throw new Error("Missing required server configuration: API_KEY_PEPPER");
  }
  return value;
}

export function requireDatabaseUrl(): string {
  return requireEnv("DATABASE_URL");
}

export function requireSupabaseBrowser(): {
  url: string;
  publishableKey: string;
} {
  return {
    url: requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    publishableKey: requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  };
}

export function requireSupabaseSecret(): string {
  return requireEnv("SUPABASE_SECRET_KEY");
}

export function requireReownProjectId(): string {
  return requireEnv("NEXT_PUBLIC_REOWN_PROJECT_ID");
}

export function requireOpenAi(): string {
  return requireEnv("OPENAI_API_KEY");
}

export function requireHelius(): { apiKey: string; rpcUrl: string } {
  return {
    apiKey: requireEnv("HELIUS_API_KEY"),
    rpcUrl: requireEnv("HELIUS_RPC_URL"),
  };
}

export function requireBirdeye(): string {
  return requireEnv("BIRDEYE_API_KEY");
}

export function requirePinata(): { jwt: string; gatewayDomain: string } {
  return {
    jwt: requireEnv("PINATA_JWT"),
    gatewayDomain: requireEnv("PINATA_GATEWAY_DOMAIN"),
  };
}

export function requireTransactionBuilder(): { url: string; secret: string } {
  return {
    url: requireEnv("TX_BUILDER_URL"),
    secret: requireEnv("TX_BUILDER_SECRET"),
  };
}

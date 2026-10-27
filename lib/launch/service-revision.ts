const REVISION = /^[0-9a-f]{40}$/;

export const PRODUCTION_COMPATIBILITY = "sdk-production-v1";

export function productionCompatibility(): typeof PRODUCTION_COMPATIBILITY {
  return PRODUCTION_COMPATIBILITY;
}

export function serviceRevision(env: NodeJS.ProcessEnv = process.env): string {
  const revision = (env.RENDER_GIT_COMMIT ?? env.VERCEL_GIT_COMMIT_SHA ?? "").trim();
  return isServiceRevision(revision) ? revision : "unverified";
}

export function isServiceRevision(value: string): boolean {
  return REVISION.test(value);
}

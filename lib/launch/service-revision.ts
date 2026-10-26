const REVISION = /^[0-9a-f]{40}$/;

export function serviceRevision(env: NodeJS.ProcessEnv = process.env): string {
  const revision = (env.RENDER_GIT_COMMIT ?? env.VERCEL_GIT_COMMIT_SHA ?? "").trim();
  return REVISION.test(revision) ? revision : "unverified";
}

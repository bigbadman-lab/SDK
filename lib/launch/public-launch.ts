// Operator TREST rehearsal routes still read this process flag.
// Production build, submit, preflight, and recover do not. A true value here cannot open public launches.
export function publicChildLaunchesOpen(flag: string | undefined = process.env.PUBLIC_CHILD_LAUNCHES): boolean {
  return flag === "true";
}

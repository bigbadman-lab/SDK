export function publicChildLaunchesOpen(flag: string | undefined = process.env.PUBLIC_CHILD_LAUNCHES): boolean {
  return flag === "true";
}

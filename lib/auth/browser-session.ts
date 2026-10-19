export type BrowserSession =
  | { status: "unknown" }
  | { status: "anonymous" }
  | { status: "signed-in"; walletAddress: string };

type Listener = (session: BrowserSession) => void;

let epoch = 0;
let current: BrowserSession = { status: "unknown" };
let pending: Promise<BrowserSession> | null = null;
const listeners = new Set<Listener>();

function publish(next: BrowserSession): void {
  current = next;
  for (const listener of listeners) listener(current);
}

export function getBrowserSession(): BrowserSession {
  return current;
}

export function subscribeBrowserSession(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}

export function noteSignedIn(walletAddress: string): void {
  epoch += 1;
  pending = null;
  publish({ status: "signed-in", walletAddress });
}

export function noteSignedOut(): void {
  epoch += 1;
  pending = null;
  publish({ status: "anonymous" });
}

export function resetBrowserSessionForTests(): void {
  epoch += 1;
  pending = null;
  listeners.clear();
  current = { status: "unknown" };
}

export async function loadBrowserSession(): Promise<BrowserSession> {
  if (pending) return pending;
  const ticket = epoch;
  const request = (async () => {
    try {
      const response = await fetch("/api/auth/session", {
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = (await response.json()) as {
        authenticated?: boolean;
        walletAddress?: string;
      };
      if (ticket !== epoch) return current;
      if (response.ok && body.authenticated === true && body.walletAddress) {
        publish({ status: "signed-in", walletAddress: body.walletAddress });
      } else {
        publish({ status: "anonymous" });
      }
      return current;
    } catch {
      if (ticket !== epoch) return current;
      publish({ status: "anonymous" });
      return current;
    } finally {
      if (ticket === epoch) pending = null;
    }
  })();
  pending = request;
  return request;
}

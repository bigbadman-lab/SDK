import { productionCompatibility, serviceRevision } from "@/lib/launch/service-revision";
import { readPublicLaunchGate } from "@/lib/server/launch/gate";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  let launches: "closed" | "active" | "unavailable" = "unavailable";
  let canonicalMint: string | null = null;
  try {
    const gate = await readPublicLaunchGate();
    launches = gate.open ? "active" : "closed";
    canonicalMint = gate.mint;
  } catch {
    launches = "unavailable";
  }
  return Response.json(
    {
      ok: true,
      service: "website",
      revision: serviceRevision(),
      compatibility: productionCompatibility(),
      launchGate: "database",
      trestFallback: false,
      launches,
      canonicalMint,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

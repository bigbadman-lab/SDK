import { getCurrentAccount } from "@/lib/server/account";
import { describeBlueprintError } from "@/lib/server/blueprint/http";
import { sendBuilderMessage } from "@/lib/server/blueprint/service";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!trustedOrigin(request)) {
    return Response.json({ error: "The blueprint request was not accepted.", code: "origin" }, { status: 400 });
  }
  const account = await getCurrentAccount();
  if (!account) {
    return Response.json({ error: "Sign in to use the Builder.", code: "unauthenticated" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The blueprint request was not accepted.", code: "body" }, { status: 400 });
  }
  if (!record(body) || typeof body.message !== "string") {
    return Response.json({ error: "The blueprint request was not accepted.", code: "body" }, { status: 400 });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        const result = await sendBuilderMessage({
          account,
          message: body.message as string,
          ...(typeof body.draftId === "string" ? { draftId: body.draftId } : {}),
          ...(typeof body.revision === "number" ? { revision: body.revision } : {}),
          onStage: (stage) => send({ stage }),
        });
        send({ stage: "ready", ...result });
      } catch (error) {
        const described = describeBlueprintError(error);
        send({ error: described.error, code: described.code });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

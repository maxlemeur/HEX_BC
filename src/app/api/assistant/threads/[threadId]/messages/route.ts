import { z } from "zod";

import { prepareAssistantReply, runAssistantReply, type AssistantStreamEvent } from "@/lib/assistant/conversation";
import { assertAssistantRequest } from "@/lib/assistant/model";
import { toErrorResponse } from "@/lib/estimates/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const paramsSchema = z.object({ threadId: z.string().uuid("threadId invalide.") });

/**
 * Asks a question in a conversation and streams the answer as server-sent
 * events. Every refusal (switch, rights, validation) is answered as JSON before
 * the stream starts; once it has started, a failure is its last event.
 */
export async function POST(request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  try {
    assertAssistantRequest(request.headers.get("host"));
    const { threadId } = paramsSchema.parse(await params);
    const prepared = await prepareAssistantReply(threadId, await request.json().catch(() => null));

    const encoder = new TextEncoder();
    // The member stops the answer by closing the request: the reply is then saved as interrupted.
    const interruption = new AbortController();
    request.signal.addEventListener("abort", () => interruption.abort(), { once: true });
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (event: AssistantStreamEvent) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            // The browser is gone: the answer is still saved, nothing more can be sent.
          }
        };
        emit({ type: "started", question: prepared.question });
        await runAssistantReply(prepared, emit, interruption.signal);
        try {
          controller.close();
        } catch {
          // Already closed by the browser.
        }
      },
      cancel() {
        interruption.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "x-accel-buffering": "no",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

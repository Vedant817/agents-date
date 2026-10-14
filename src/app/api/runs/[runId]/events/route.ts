import { snapshot, subscribe, waitForRun } from "@/pipeline/background";
import { getStore } from "@/store/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live progress for a run, as Server-Sent Events.
 *
 * Run creation and extension return 202 immediately and process in the
 * background. The browser opens this stream to watch each person get read,
 * then the dates, then completion — instead of staring at a spinner over a
 * held-open POST.
 *
 * A late subscriber first gets a snapshot of the current state, so opening
 * the stream mid-run (or refreshing) still shows where things stand. The
 * stream closes itself on complete/failed.
 */
export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(runId)) {
    return new Response("Unknown run.\n", { status: 404 });
  }
  const store = getStore();
  let exists = false;
  try {
    exists = (await store.get(runId)) !== null;
  } catch {
    return Response.json({ error: "The run could not be read." }, { status: 500 });
  }
  if (!exists) {
    return new Response("Unknown run.\n", { status: 404 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      // Declared up front: close() can run before the heartbeat and the
      // subscription exist (a finished run closes immediately), and a const
      // declared below would throw a temporal-dead-zone ReferenceError.
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let unsub: () => void = () => undefined;
      let closed = false;
      const close = () => {
        if (!closed) {
          closed = true;
          if (heartbeat) clearInterval(heartbeat);
          unsub();
          try {
            controller.close();
          } catch {
            // Already closed by the client going away.
          }
        }
      };
      const send = (type: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      // Replay current state first so a refresh mid-run is not blank.
      const first = await snapshot(runId);
      send(first.type === "snapshot" ? "snapshot" : first.type, first);
      if (first.type === "complete" || first.type === "failed") {
        close();
        return;
      }

      unsub = subscribe(runId, (evt) => {
        send(evt.type, evt);
        if (evt.type === "complete" || evt.type === "failed") {
          // Flush the terminal event, then close on the next tick so it is
          // not lost to a consumer that is still draining.
          setTimeout(close, 50);
        }
      });

      // Proxies and browsers drop silent streams; a comment every 15s keeps
      // the connection (and its timeouts) alive through a long capture.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          close();
        }
      }, 15_000);

      // Belt and braces: if the background job settles without emitting
      // (process edge cases), re-check and close rather than hanging forever.
      void waitForRun(runId, 10 * 60_000).then(async () => {
        if (closed) return;
        const last = await snapshot(runId).catch(() => null);
        if (last && (last.type === "complete" || last.type === "failed")) send(last.type, last);
        close();
      });
    },
    cancel() {
      // The per-stream unsubscribe happens in close(); cancel() fires when
      // the client goes away first, and there is nothing else to clean up.
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

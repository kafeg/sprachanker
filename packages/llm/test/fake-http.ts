// A fake provider for the clients' tests: records requests and answers as told; streams by chunks.

/** A fake server: records requests and answers with the given response. */
export function fakeFetch(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

/** The JSON bodies posted. */
export const bodies = (calls: Array<{ init: RequestInit }>) =>
  calls.map((c) => JSON.parse(c.init.body as string) as Record<string, unknown>);

/** A server-sent event stream of these chunks. */
export const sse = (chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );

export async function collect(stream: AsyncIterable<string>) {
  let out = "";
  for await (const chunk of stream) out += chunk;
  return out;
}

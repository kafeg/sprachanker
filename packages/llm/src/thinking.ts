// Reasoning models (Qwen3, DeepSeek R1…) may put their thinking inline as <think>…</think>; the learner
// sees only the answer.
const OPEN = "<think>";
const CLOSE = "</think>";

/** Removes <think>…</think> blocks from a text stream, also when tags are split across chunks. */
export async function* stripThinking(source: AsyncIterable<string>): AsyncIterable<string> {
  let pending = "";
  let thinking = false;
  let started = false;
  for await (const chunk of source) {
    pending += chunk;
    while (true) {
      const tag = thinking ? CLOSE : OPEN;
      const at = pending.indexOf(tag);
      if (at >= 0) {
        if (!thinking) yield* emit(pending.slice(0, at));
        pending = pending.slice(at + tag.length);
        thinking = !thinking;
        continue;
      }
      // Keep a possible partial tag at the end for the next chunk.
      const keep = partialSuffix(pending, tag);
      if (!thinking) yield* emit(pending.slice(0, pending.length - keep));
      pending = pending.slice(pending.length - keep);
      break;
    }
  }
  if (!thinking) yield* emit(pending);

  function* emit(text: string) {
    // Text before the answer starts (newlines after </think>) is dropped.
    const out = started ? text : text.trimStart();
    if (!out) return;
    started = true;
    yield out;
  }
}

function partialSuffix(text: string, tag: string): number {
  for (let n = Math.min(tag.length - 1, text.length); n > 0; n--) {
    if (text.endsWith(tag.slice(0, n))) return n;
  }
  return 0;
}

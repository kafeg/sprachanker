// Taking a deck reads anew what counts its words: the cards, and what is made for its words (audio,
// examples) — "18 words without examples" becomes the whole deck's at once.
import { afterEach, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { DECK_AUDIO, DECK_EXAMPLES, useDeckActions } from "../../src/api/cards.ts";
import { queryClient } from "../render.tsx";

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

test("a deck taken: the cards, its audio and its examples read anew", async () => {
  globalThis.fetch = (async () => Response.json({ created: 3 })) as unknown as typeof fetch;
  const client = queryClient([
    [["deck-offers"], []],
    [[DECK_AUDIO, "course:x"], { words: 18 }],
    [[DECK_EXAMPLES, "course:x", "en-de"], { words: 18 }],
    [["llm"], { provider: null }],
  ]);
  const { result } = renderHook(() => useDeckActions(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await act(async () => {
    await result.current.take.mutateAsync({ series: "s", course: "x", edition: "en-de" } as never);
  });
  const stale = (key: unknown[]) => client.getQueryState(key)?.isInvalidated;
  await waitFor(() => expect(stale([DECK_EXAMPLES, "course:x", "en-de"])).toBe(true));
  expect(stale([DECK_AUDIO, "course:x"])).toBe(true);
  expect(stale(["deck-offers"])).toBe(true);
  expect(stale(["llm"])).toBe(false);
});

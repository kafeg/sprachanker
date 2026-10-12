// OpenRouter's own API beside the OpenAI-compatible one: the state of the learner's
// key — free tier or credits, what is used and left, the rate limit — as far as OpenRouter tells it.
import { bearer, endpointCaller } from "./http.ts";

export interface OpenRouterKey {
  /** The account has bought no credits: free models only, with the free tier's daily limit. */
  freeTier?: boolean;
  /** Credits used, in US dollars. */
  usage?: number;
  /** The key's own spending limit and what is left of it, when one is set. */
  limit?: number;
  remaining?: number;
  /** Requests allowed per interval ("10s", "1m"), when OpenRouter tells it. */
  rateLimit?: { requests: number; interval: string };
}

const QUICK_MS = 10_000;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** `baseUrl` is the provider's OpenAI-compatible one (…/api/v1); the key's state is `GET /key` there. */
export async function openRouterKey(
  endpoint: { baseUrl: string; apiKey?: string },
  fetchFn = fetch,
  signal?: AbortSignal,
): Promise<OpenRouterKey> {
  const call = endpointCaller(endpoint.baseUrl, bearer(endpoint.apiKey), fetchFn);
  const res = await call("/key", { method: "GET" }, QUICK_MS, signal);
  const body = (await res.json().catch(() => null)) as { data?: Record<string, unknown> } | null;
  const d = body?.data ?? {};
  const rate = d.rate_limit as { requests?: unknown; interval?: unknown } | undefined;
  const requests = num(rate?.requests);
  return {
    ...(typeof d.is_free_tier === "boolean" && { freeTier: d.is_free_tier }),
    ...(num(d.usage) !== undefined && { usage: num(d.usage) }),
    ...(num(d.limit) !== undefined && { limit: num(d.limit) }),
    ...(num(d.limit_remaining) !== undefined && { remaining: num(d.limit_remaining) }),
    ...(requests !== undefined &&
      typeof rate?.interval === "string" && { rateLimit: { requests, interval: rate.interval } }),
  };
}

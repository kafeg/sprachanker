// What goes wrong talking to a model (07): a code the server answers with as `llm_<code>`.

type LlmErrorCode =
  | "unreachable"
  | "unauthorized"
  | "model_not_found"
  | "timeout"
  | "bad_response"
  /** The provider's limit is reached for now (429: free tiers limit requests per minute and day). */
  | "rate_limited"
  /** The provider has no room for the request now (Anthropic's 529): it may be asked again shortly. */
  | "overloaded"
  /** The model declined to answer (Anthropic's `refusal` stop, OpenAI's `refusal`). */
  | "refused"
  /** A structured reply stayed invalid after the repair attempt. */
  | "invalid_output";

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    /** The HTTP status the provider answered with, when it answered. */
    readonly status?: number,
    /** Seconds to wait before asking again, when the provider says (`retry-after`). */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

// What goes wrong talking to a model (07): a code the server answers with as `llm_<code>`.

type LlmErrorCode =
  | "unreachable"
  | "unauthorized"
  | "model_not_found"
  | "timeout"
  | "bad_response"
  /** The provider's limit is reached for now (429: free tiers limit requests per minute and day). */
  | "rate_limited"
  /** A structured reply stayed invalid after the repair attempt. */
  | "invalid_output";

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    /** The HTTP status the provider answered with, when it answered. */
    readonly status?: number,
  ) {
    super(message);
  }
}

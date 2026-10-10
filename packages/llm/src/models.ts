// What an OpenAI-compatible `/models` list tells of each model (07, "Providers"): the chat models
// with their name, price, context length, JSON and tool support and publisher.

/** A chat model and what its endpoint tells of it (OpenRouter tells much, most servers only the id). */
export interface ModelInfo {
  id: string;
  name?: string;
  /** Costs nothing (OpenRouter's free variants). */
  free?: boolean;
  /** Price in US dollars per million tokens read and written. */
  price?: { input: number; output: number };
  /** Tokens it takes in at once. */
  contextLength?: number;
  /** Answers in a JSON schema (structured outputs): writing checks and scenes need it. */
  json?: boolean;
  /** Calls tools (the tutor's). */
  tools?: boolean;
  /** Who made it ("anthropic" of "anthropic/claude-…"). */
  publisher?: string;
}

export interface RawModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  /** Groq's name for the context length. */
  context_window?: unknown;
  /** Who serves it (Groq, Gemini); the publisher when the id does not name one. */
  owned_by?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  architecture?: { output_modalities?: unknown };
  supported_parameters?: unknown;
}

const perMillion = (value: unknown) => {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1000) / 1000 : undefined;
};

/**
 * A model of an OpenAI-compatible `/models` list with what the endpoint tells of it; undefined for one
 * that is no chat model: an embedding model, speech in or out, an image or video generator, a safety
 * classifier — by its id where the list does not say (Groq, Gemini) —, or one whose output is not
 * text alone.
 */
const NOT_CHAT = /embed|whisper|tts|orpheus|guard|imagen|veo|image|audio|aqa/i;

export function modelInfo(raw: RawModel): ModelInfo | undefined {
  if (typeof raw.id !== "string" || NOT_CHAT.test(raw.id)) return undefined;
  const output = raw.architecture?.output_modalities;
  if (Array.isArray(output) && output.some((m) => m !== "text")) return undefined;
  const input = perMillion(raw.pricing?.prompt);
  const outputPrice = perMillion(raw.pricing?.completion);
  const params = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : undefined;
  const slash = raw.id.indexOf("/");
  return {
    id: raw.id,
    ...(typeof raw.name === "string" && { name: raw.name }),
    ...((raw.id.endsWith(":free") || (input === 0 && outputPrice === 0)) && { free: true }),
    ...(input !== undefined &&
      outputPrice !== undefined && { price: { input, output: outputPrice } }),
    ...(typeof raw.context_length === "number" && { contextLength: raw.context_length }),
    ...(typeof raw.context_window === "number" && { contextLength: raw.context_window }),
    ...(params && {
      json: params.includes("response_format") || params.includes("structured_outputs"),
      tools: params.includes("tools"),
    }),
    ...(slash > 0
      ? { publisher: raw.id.slice(0, slash) }
      : typeof raw.owned_by === "string" && raw.owned_by && { publisher: raw.owned_by }),
  };
}

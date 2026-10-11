// A server voice's name as Settings → Speech shows it (pure): a Qwen3-TTS speaker ("uncle_fu" →
// "Uncle fu"), a Piper voice by its id ("de_DE-thorsten-medium" → "thorsten").

export const speakerName = (s: string) =>
  s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** A voice a server engine reads with: Piper's id, Qwen3-TTS's `<model>/<speaker>`. */
export function voiceName(engine: "piper" | "qwen", voice: string): string {
  if (engine === "qwen") return speakerName(voice.split("/").at(-1) ?? voice);
  return (/^[^-]+-(.+)-[^-]+$/.exec(voice)?.[1] ?? voice).replace(/_/g, " ");
}

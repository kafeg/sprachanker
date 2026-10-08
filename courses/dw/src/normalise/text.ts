// DW-specific text checks (plain text itself comes from course-kit).
import type { ApolloState } from "../apollo.ts";

/** The player's labels known before a page tells its own (pages without their interface strings). */
const KNOWN_LABELS = ["Прослушать аудио", "Play audio", "Audio abspielen"];

/**
 * Labels of DW's player that appear in content fields, not content: the page's own interface strings
 * (`i18nByLang(…).all`, `exercise.playAudio`), so every edition language is covered.
 */
export function uiLabels(state: ApolloState): Set<string> {
  const labels = new Set(KNOWN_LABELS.map((l) => l.toLocaleLowerCase()));
  const root = state.ROOT_QUERY as Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(root ?? {})) {
    if (!key.startsWith("i18nByLang")) continue;
    try {
      const all = (value as { all?: unknown }).all;
      const strings = JSON.parse(typeof all === "string" ? all : "{}") as {
        exercise?: { playAudio?: unknown };
      };
      const label = strings.exercise?.playAudio;
      if (typeof label === "string" && label.trim()) labels.add(label.trim().toLocaleLowerCase());
    } catch {
      // Interface strings that do not read: the known labels stay.
    }
  }
  return labels;
}

export const isUiLabel = (text: string, labels: Set<string>) =>
  labels.has(text.trim().toLocaleLowerCase());

// Files the e2e run shares between its setup and the tests.
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The data root the server runs on (written by fixture-data.ts before the run). */
export const E2E_DATA = join(tmpdir(), "sprachanker-e2e");

/** The signed-in profile's cookies (written by signed-in.setup.ts). */
export const SIGNED_IN = join(tmpdir(), "sprachanker-e2e-signed-in.json");

/** A synthetic deck file (written by fixture-data.ts), imported in Review → Decks. */
export const E2E_DECK = join(tmpdir(), "sprachanker-e2e-deck.apkg");

/** Piper on paper (written by fixture-data.ts, named to the server by SPRACHANKER_PIPER): a short
 *  silent WAV for any text. */
export const E2E_PIPER = join(tmpdir(), "sprachanker-e2e-piper.sh");
/** The voice it reads German with, "installed" in the e2e data root. */
export const E2E_VOICE = "de_DE-thorsten-medium";

/** Qwen3-TTS's tts-server on paper (written by fixture-data.ts, named to the server by
 *  SPRACHANKER_QWEN): a short silent WAV for any text; its small model "installed" beside it. */
export const E2E_QWEN = join(tmpdir(), "sprachanker-e2e-qwen.ts");

/** The fixture's framed speaking item's answer recording as heard (written by fixture-data.ts into
 *  the course: the server has no Whisper in the e2e run). */
export const E2E_HEARD = { text: "Guten Abend! Danke, gut. Und dir?", model: "e2e", heardAt: 1 };

import { expect, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { SelectionMenu } from "../../src/audio/selection-menu.tsx";
import { SpeakButton } from "../../src/audio/speak-button.tsx";
import { renderApp } from "../render.tsx";

const qwen: [unknown[], unknown] = [
  ["qwen-tts"],
  {
    engine: true,
    models: [{ id: "0.6b", bytes: 968e6, installed: true, inUse: true }],
    languages: ["de"],
    speakers: ["ryan"],
    defaultSpeaker: "ryan",
    wordModel: { id: "base", bytes: 2079e6, installed: false },
    words: {},
  },
];
const settings: [unknown[], unknown] = [["settings"], { "speech.readEngine": "qwen" }];

test("Qwen3-TTS is started where something is to be read, not by the selection bar every page has (a phone would close the app for its memory)", async () => {
  const asked: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    asked.push(`${request.method} ${new URL(request.url).pathname}`);
    return Response.json({});
  }) as typeof fetch;
  const bar = await renderApp(<SelectionMenu />, { data: [qwen, settings] });
  await new Promise((r) => setTimeout(r, 50));
  expect(asked).not.toContain("POST /api/speech/qwen/warm");
  bar.unmount();

  await renderApp(<SpeakButton parts={[{ text: "Guten Tag", lang: "de" }]} />, {
    data: [qwen, settings],
  });
  await waitFor(() => expect(asked).toContain("POST /api/speech/qwen/warm"));
});

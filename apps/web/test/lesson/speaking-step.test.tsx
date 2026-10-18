// A speaking exercise in the player: an answer said aloud checked against the source's answer as
// heard — its mark, "Try again", the AI only when asked why.
import { expect, test } from "bun:test";
import { checkItem, exerciseResults } from "@sprachanker/engine";
import type { Exercise, TypedEvent } from "@sprachanker/schema";
import { act, fireEvent } from "@testing-library/react";
import { SpeechProvider } from "../../src/audio/context.ts";
import { HeardAnswers } from "../../src/exercises/shared.tsx";
import { ExerciseStep } from "../../src/lesson/exercise-step.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { renderApp } from "../render.tsx";

const KEY = "sprachanker.test/demo/00-01/ex-03";
const AUDIO = "media/audio/answer.mp3";
const exercise = {
  key: KEY,
  type: "speech_selfrate",
  fingerprint: "x",
  newWords: [],
  ruleIds: [],
  items: [
    {
      key: `${KEY}#1`,
      prompt: "Guten Abend. Wie geht es dir?",
      reference: ["Guten Abend. Danke, gut ..."],
      answerAudio: AUDIO,
    },
  ],
} as unknown as Exercise;
const heard = { texts: { [AUDIO]: "Guten Abend! Danke, gut. Und dir?" }, pending: false };
const host = {
  save: async () => "01K00000000000000000000000",
  src: (id: string) => `/api/recordings/${id}`,
  recognition: true,
  transcribe: async () => "",
  warm() {},
};

/** The run's first answer to the item: what was heard, checked as the server checks it. */
const stored = (transcript: string) => {
  const answer = { recording: "01K00000000000000000000000", transcript };
  const event = {
    id: "e1",
    runId: "r",
    type: "answered",
    itemKey: `${KEY}#1`,
    ts: 1,
    payload: {
      answer,
      attempt: 1,
      ms: 1,
      outcome: checkItem(exercise, 0, answer, "de", heard.texts),
    },
  } as unknown as TypedEvent;
  return exerciseResults([event])[KEY];
};

const render = (transcript: string, spoken = (_: number, said: string) => <p>AI: {said}</p>) =>
  renderApp(
    <SpeechProvider value={host}>
      <TargetLang value="de">
        <HeardAnswers.Provider value={heard}>
          <ExerciseStep
            exercise={exercise}
            index={0}
            total={3}
            url={(p) => p}
            stored={stored(transcript)}
            onAnswered={() => {}}
            onBack={() => {}}
            onNext={() => {}}
            spoken={spoken}
            explain={() => <p>explain</p>}
          />
        </HeardAnswers.Provider>
      </TargetLang>
    </SpeechProvider>,
  );

test("a wrong spoken answer: its verdict and the right answer, Try again, the AI only on asking why", async () => {
  const view = await render("Guten Abend! Wie geht es dir?");
  expect(view.getByText("Not the answer asked for: compare with the right answer")).toBeTruthy();
  expect(view.getByText("Guten Abend! Danke, gut. Und dir?")).toBeTruthy();
  // The engine decided: no AI by itself.
  expect(view.queryByText(/^AI:/)).toBeNull();
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Why is this wrong?" }));
  });
  expect(view.getByText("AI: Guten Abend! Wie geht es dir?")).toBeTruthy();
  // Said again from the start: the microphone back, the verdict gone.
  expect(view.queryByRole("button", { name: "Record yourself" })).toBeNull();
  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
  });
  expect(view.getByRole("button", { name: "Record yourself" })).toBeTruthy();
  expect(view.queryByText(/^Not the answer asked for/)).toBeNull();
});

test("a right spoken answer: no why to ask; an answer the engine cannot judge goes to the AI by itself", async () => {
  const right = await render("Guten Abend, danke gut, und dir");
  expect(right.getByText("You said it")).toBeTruthy();
  expect(right.queryByRole("button", { name: "Why is this wrong?" })).toBeNull();
  expect(right.getByRole("button", { name: "Try again" })).toBeTruthy();
  right.unmount();

  // No source's answer heard for it: nothing to judge by, so the AI checks it at once.
  const free = await renderApp(
    <SpeechProvider value={host}>
      <TargetLang value="de">
        <ExerciseStep
          exercise={{ ...exercise, items: [{ key: `${KEY}#1`, answerAudio: AUDIO }] } as Exercise}
          index={0}
          total={3}
          url={(p) => p}
          stored={
            exerciseResults([
              {
                id: "e1",
                runId: "r",
                type: "answered",
                itemKey: `${KEY}#1`,
                ts: 1,
                payload: {
                  answer: { transcript: "Ich mag Kaffee" },
                  attempt: 1,
                  ms: 1,
                  outcome: { result: "unscored", score: 0 },
                },
              } as unknown as TypedEvent,
            ])[KEY]
          }
          onAnswered={() => {}}
          onBack={() => {}}
          onNext={() => {}}
          spoken={(_, said) => <p>AI: {said}</p>}
        />
      </TargetLang>
    </SpeechProvider>,
  );
  expect(free.getByText("AI: Ich mag Kaffee")).toBeTruthy();
});

import { expect, test } from "bun:test";
import { cardAudioUrl } from "../../src/api/client.ts";
import { StudyCard } from "../../src/study/card.tsx";
import { TargetLang } from "../../src/ui/target-lang.ts";
import { renderApp } from "../render.tsx";

const display = { target: "auch", translation: "also", series: "x", lessonKey: "x/c/00-01" };

test("a card says which way it asks: card 1 the meaning, card 2 the word in the language learnt", async () => {
  const card = (face: "recognition" | "production") =>
    renderApp(
      <TargetLang value="de">
        <StudyCard display={display} face={face} side="question" />
      </TargetLang>,
    );
  expect((await card("recognition")).getByText("What does it mean?")).toBeTruthy();
  const second = await card("production");
  expect(second.getByText("In German?")).toBeTruthy();
  expect(second.getByText("also")).toBeTruthy();
});

test("a listening card: the question is heard, not read; the answer shows the word once and its meaning", async () => {
  const card = (side: "question" | "answer") =>
    renderApp(
      <TargetLang value="de">
        <StudyCard display={display} face="listening" side={side} />
      </TargetLang>,
      // The answer links to its lesson.
      { path: "/review" },
    );
  expect((await card("question")).queryByText("auch")).toBeNull();
  const answer = await card("answer");
  expect(answer.getAllByText("auch")).toHaveLength(1);
  expect(answer.getByText("also")).toBeTruthy();
});

test("an imported deck's word: no lesson to go to; its recording in the deck's folder, a course's in the library", async () => {
  const deckWord = {
    target: "der Abend",
    translation: "evening",
    audio: "media/abend.mp3",
    deck: "a1-abc123",
  };
  const view = await renderApp(
    <TargetLang value="de">
      <StudyCard display={deckWord} face="recognition" side="answer" />
    </TargetLang>,
    { path: "/review" },
  );
  expect(view.getByText("evening")).toBeTruthy();
  expect(view.queryByRole("link")).toBeNull();
  // The deck's own examples under the answer, each with its translation and its recording.
  const withExamples = await renderApp(
    <TargetLang value="de">
      <StudyCard
        display={{
          ...deckWord,
          examples: [
            { sentence: "Guten Abend!", translation: "Good evening!", audio: "media/g.mp3" },
          ],
        }}
        face="production"
        side="answer"
      />
    </TargetLang>,
    { path: "/review" },
  );
  expect(withExamples.getByText("Guten Abend!").getAttribute("lang")).toBe("de");
  expect(withExamples.getByText("Good evening!")).toBeTruthy();
  expect(withExamples.getByRole("button", { name: /Guten Abend!/ })).toBeTruthy();
  expect(cardAudioUrl(deckWord)).toBe("/decks/a1-abc123/media/abend.mp3");
  expect(cardAudioUrl({ ...display, audio: "media/audio/auch.mp3" })).toBe(
    "/library/x/media/audio/auch.mp3",
  );
});

test("a word without its own recording plays the one read aloud for its deck, from the deck's folder", () => {
  const read = "course~x.y~c/media/read-0123456789ab.wav";
  expect(cardAudioUrl({ ...display, readAudio: read })).toBe(`/decks/${read}`);
  // Its own recording first.
  expect(cardAudioUrl({ ...display, audio: "media/audio/auch.mp3", readAudio: read })).toBe(
    "/library/x/media/audio/auch.mp3",
  );
  expect(cardAudioUrl(display)).toBeUndefined();
});

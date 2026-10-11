import { expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import { cardAudioUrl } from "../../src/api/client.ts";
import { StudyCard } from "../../src/study/card.tsx";
import { StudySlotsProvider } from "../../src/study/slots.ts";
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
  // The deck's own examples: none at first, one on "Example", with its translation and its recording.
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
  expect(withExamples.queryByText("Guten Abend!")).toBeNull();
  fireEvent.click(withExamples.getByRole("button", { name: "Example" }));
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
  // Neither in a deck: the card's own recording where it was made.
  const own = "library/x/media/audio/auch.mp3";
  expect(cardAudioUrl({ ...display, recordingPath: own })).toBe(`/${own}`);
  expect(cardAudioUrl({ ...display, readAudio: read, recordingPath: own })).toBe(`/decks/${read}`);
});

test("a word without a recording is never read on the fly: no play button; with the answer, the way to its deck", async () => {
  const card = (side: "question" | "answer") =>
    renderApp(
      <TargetLang value="de">
        <StudyCard display={display} face="recognition" side={side} />
      </TargetLang>,
      { path: "/review" },
    );
  const question = await card("question");
  expect(question.queryByRole("button", { name: /^(Play|Read aloud):/ })).toBeNull();
  expect(question.queryByRole("link")).toBeNull();
  question.unmount();
  const answer = await card("answer");
  expect(answer.queryByRole("button", { name: /auch|Read aloud/ })).toBeNull();
  expect(answer.getByRole("link", { name: "Read the deck aloud" }).getAttribute("href")).toBe(
    "/review/decks#deck-course-x-c",
  );
  answer.unmount();
  // Read for its deck: it plays that, and the corner has nothing more to say.
  const read = await renderApp(
    <TargetLang value="de">
      <StudyCard
        display={{ ...display, readAudio: "course~x~c/media/read-0123456789ab.wav" }}
        face="recognition"
        side="answer"
      />
    </TargetLang>,
    { path: "/review" },
  );
  expect(read.getByRole("button", { name: /auch/ })).toBeTruthy();
  expect(read.queryByRole("link", { name: "Read the deck aloud" })).toBeNull();
});

test("the card's corner is one row — the way to its deck left of the recording's button — so on a phone it stays above the question; the question side has the recording alone", async () => {
  const withAudio = { ...display, readAudio: "course~x~c/media/read-0123456789ab.wav" };
  const corner = (side: "question" | "answer") =>
    renderApp(
      <StudySlotsProvider
        value={{ corner: ({ scope }) => <a href={`/review/decks#${scope}`}>{scope}</a> }}
      >
        <TargetLang value="de">
          <StudyCard cardId="c1" display={withAudio} face="recognition" side={side} />
        </TargetLang>
      </StudySlotsProvider>,
      { path: "/review" },
    );
  const question = await corner("question");
  const asked = question.container.querySelector("[data-card-corner]") as HTMLElement;
  expect(asked.querySelectorAll("button")).toHaveLength(1);
  expect(asked.querySelector("a")).toBeNull();
  question.unmount();
  const answer = await corner("answer");
  const shown = answer.container.querySelector("[data-card-corner]") as HTMLElement;
  // A row: the button (first, shown rightmost) and the link beside it, on one line.
  expect(shown.className).toContain("flex-row-reverse");
  expect(shown.className).toContain("items-center");
  expect(shown.className).not.toContain("flex-col");
  expect([...shown.children].map((c) => c.tagName)).toEqual(["BUTTON", "A"]);
  // The row (44 px from 12 px down) above the face's top padding of 64 px.
  expect(answer.container.querySelector("[data-study-card]")?.className).toContain("pt-16");
});

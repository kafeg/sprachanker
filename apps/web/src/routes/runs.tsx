// The two full-screen runs with what the assistant adds to them (llm/ slots), a chunk of their own that
// the router loads when one is first opened.
import type { ComponentProps } from "react";
import { ExamPlayer } from "@/exams/player.tsx";
import { ExamSlotsProvider } from "@/exams/slots.ts";
import { LessonPlayer } from "@/lesson/player.tsx";
import { examAssistant } from "@/llm/exam-assistant.tsx";
import { lessonAssistant } from "@/llm/lesson-assistant.tsx";

export function LessonRun(props: Omit<ComponentProps<typeof LessonPlayer>, "slots">) {
  return <LessonPlayer slots={lessonAssistant} {...props} />;
}

export function ExamRun(props: ComponentProps<typeof ExamPlayer>) {
  return (
    <ExamSlotsProvider value={examAssistant}>
      <ExamPlayer {...props} />
    </ExamSlotsProvider>
  );
}

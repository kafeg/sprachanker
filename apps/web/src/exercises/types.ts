import type {
  DictationAnswer,
  Exercise,
  GapChoiceAnswer,
  GapTextAnswer,
  LocaleItem,
  MatchAnswer,
  MultiChoiceAnswer,
  OrderAnswer,
  Outcome,
  SingleChoiceAnswer,
  SpeechSelfrateAnswer,
} from "@sprachanker/schema";

export type ExerciseType = Exercise["type"];
export type ItemOf<T extends ExerciseType> = Extract<Exercise, { type: T }>["items"][number];

export interface Answers {
  single_choice: SingleChoiceAnswer;
  multi_choice: MultiChoiceAnswer;
  match: MatchAnswer;
  order: OrderAnswer;
  gap_choice: GapChoiceAnswer;
  gap_text: GapTextAnswer;
  dictation: DictationAnswer;
  speech_selfrate: SpeechSelfrateAnswer;
}

export interface RendererProps<T extends keyof Answers> {
  item: ItemOf<T>;
  locale?: LocaleItem;
  answer: Answers[T] | undefined;
  onAnswer(answer: Answers[T]): void;
  /** Set after checking: renderers show the correct answer and lock input. */
  outcome?: Outcome;
  url(path: string): string;
}

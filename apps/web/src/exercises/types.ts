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
  RespondAnswer,
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
  respond: RespondAnswer;
}

export interface RendererProps<T extends keyof Answers> {
  item: ItemOf<T>;
  locale?: LocaleItem;
  answer: Answers[T] | undefined;
  onAnswer(answer: Answers[T]): void;
  /** Set after checking: renderers show the correct answer and lock input. */
  outcome?: Outcome;
  url(path: string): string;
  /** The item the number keys (1–9) choose in; it shows the numbers where there is a keyboard. */
  active?: boolean;
  /** The recordings the item is about have been played (recording oneself waits for it). */
  heard?: boolean;
  /** Shown as answered, nothing to change (the Notebook). */
  readOnly?: boolean;
}

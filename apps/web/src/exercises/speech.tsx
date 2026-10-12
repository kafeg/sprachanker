// Speaking exercises: SpeechSelfrate (saying it oneself after the original, one's take beside
// it) and SpeechRepeat (a phrase said and checked by the words heard); their takes and what was heard.
import { linesToSay, spokenCheck } from "@sprachanker/engine";
import { Check, CircleDot, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSpeechHost } from "@/audio/context.ts";
import { MicButton } from "@/audio/mic-button.tsx";
import { heardNothing, type Take, useRecorder } from "@/audio/recorder.ts";
import { KeptTake, TakeButton } from "@/audio/take-button.tsx";
import { CourseHtml } from "@/ui/course-html.tsx";
import { inLang } from "@/ui/direction.tsx";
import { clock } from "@/ui/format.ts";
import { keptTogether } from "@/ui/line-breaks.ts";
import { useTargetLang } from "@/ui/target-lang.ts";
import { cn } from "@/ui/utils.ts";
import type { RendererProps } from "./types.ts";

/** What the recogniser heard: against the line to say (the closest of its alternatives), its
 *  words matched and missed with a verdict; for a free answer, just the words heard. In no score. */
function Heard({
  lang,
  reference,
  transcript,
}: {
  lang?: string;
  reference?: string | string[];
  transcript: string;
}) {
  const { t } = useTranslation();
  // Without a language known the words still compare ("und": undetermined).
  const check = reference ? spokenCheck(lang || "und", reference, transcript) : undefined;
  const Icon =
    check?.verdict === "correct" ? Check : check?.verdict === "partial" ? CircleDot : RotateCcw;
  return (
    <div className="space-y-1.5 rounded-xl bg-muted/60 px-4 py-3" aria-live="polite">
      {check && (
        <p
          className={cn(
            "flex items-center gap-1.5 font-medium",
            check.verdict === "correct"
              ? "text-correct"
              : check.verdict === "wrong" && "text-wrong",
          )}
        >
          <Icon className="size-4" /> {t(`speech.verdict.${check.verdict}`)}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        {t("speech.heard")}{" "}
        <span {...inLang(lang)} className="text-foreground">
          {transcript || t("speech.heardNothing")}
        </span>
      </p>
      {check && check.verdict !== "correct" && (
        <p {...inLang(lang)} className="flex flex-wrap gap-x-1.5 gap-y-1 text-lg leading-relaxed">
          {check.diff
            .filter((d) => d.op !== "extra")
            .map((d, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: the words of one fixed phrase
                key={i}
                className={cn(
                  "rounded px-1",
                  d.op === "equal" ? "text-correct" : "bg-wrong-soft text-wrong",
                )}
              >
                {d.expected ?? d.actual}
              </span>
            ))}
        </p>
      )}
    </div>
  );
}

/** How long a take waits to be heard before it counts without what was heard (heard later). */
const HEARING_MS = 15_000;
const LATE = Symbol("late");

/**
 * One's takes of an item: kept when recordings are and heard when recognition is on, at once and
 * side by side; a take nothing was heard in — nothing loud in it, or only what the recogniser makes of
 * silence and noise — is not the item's answer, its recording forgotten, the learner asked to say it
 * again. Hearing failing leaves the take itself, but with `byWords` (a take that counts by its words)
 * its recording goes too. Hearing taking longer than `HEARING_MS` (the host's `hearingMs`), the take
 * counts as kept — "not heard yet" — and what was heard follows when it comes. A take neither kept nor
 * heard (failing) is no answer over an earlier one (`answered`). `expected`: the lines to say (telling
 * one said from what silence is heard as). `done` gets what was kept and heard, for the latest take
 * only — also once the item is gone (Next pressed while it is heard): the take is still its answer.
 * The recogniser starts loading as the item shows (while the learner listens to the original), and
 * again when recognition comes on or changes model.
 */
function useTakes(
  lang: string | undefined,
  readOnly: boolean | undefined,
  done: (kept: { recording?: string; transcript?: string }) => void,
  {
    byWords = false,
    expected,
    answered = false,
  }: { byWords?: boolean; expected?: readonly string[]; answered?: boolean } = {},
) {
  const host = useSpeechHost();
  const [take, setTake] = useState<{ url: string; ms: number }>();
  const [saving, setSaving] = useState(false);
  const [unsaved, setUnsaved] = useState(false);
  const [unheard, setUnheard] = useState(false);
  const [late, setLate] = useState(false);
  const [silent, setSilent] = useState(false);
  /** The latest take's number: an earlier take still being heard gives no answer. */
  const latest = useRef(0);
  useEffect(() => {
    if (!readOnly) host?.warm();
  }, [readOnly, host?.warm]);
  useEffect(
    () => () => {
      if (take) URL.revokeObjectURL(take.url);
    },
    [take],
  );
  const recorder = useRecorder({ onTake: (recorded) => void taken(recorded) });
  const taken = async (recorded: Take) => {
    const n = ++latest.current;
    const current = () => latest.current === n;
    setSilent(heardNothing(recorded));
    if (heardNothing(recorded)) return;
    setTake({ url: URL.createObjectURL(recorded.blob), ms: recorded.ms });
    setUnsaved(false);
    setUnheard(false);
    setLate(false);
    setSaving(true);
    let failed = false;
    const saved = host
      ? host.save(recorded).catch(() => {
          failed = true;
          if (current()) setUnsaved(true);
          return undefined;
        })
      : Promise.resolve(undefined);
    // Recognition needs the language spoken (never detected).
    const hearing =
      host?.recognition && lang
        ? host.transcribe(recorded, lang, expected).catch(() => {
            failed = true;
            if (current()) setUnheard(true);
            return undefined;
          })
        : undefined;
    const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined };
    const first = hearing
      ? await Promise.race([
          hearing,
          new Promise<typeof LATE>((r) => {
            timer.id = setTimeout(() => r(LATE), host?.hearingMs ?? HEARING_MS);
          }),
        ])
      : undefined;
    clearTimeout(timer.id);
    const recording = await saved;
    /** What was heard, as it ends: the answer, or nothing heard (the take forgotten — unless it
     *  counted already, kept before it was heard: `counted`). */
    const heard = (transcript: string | undefined, counted = false) => {
      if (!counted && (transcript === "" || (byWords && transcript === undefined)) && recording)
        host?.forget?.(recording);
      if (!current()) return;
      setSaving(false);
      setLate(false);
      if (transcript === "") {
        setTake(undefined);
        setSilent(true);
        return;
      }
      if (transcript === undefined && (counted || (failed && answered && !recording))) return;
      done({ ...(recording && { recording }), ...(transcript !== undefined && { transcript }) });
    };
    if (first !== LATE) return heard(first);
    // Not heard in time: kept now (what counts by its words waits), heard later.
    const counted = !byWords && !!recording && current();
    if (current()) {
      setSaving(false);
      setLate(true);
      if (counted) done({ recording });
    }
    heard(await hearing, counted);
  };
  return { host, take, saving, unsaved, unheard, late, silent, recorder };
}

/** What the take's line under the microphone says: recording, saving or listening, what failed,
 *  then how to go on. */
function TakeStatus({
  takes,
  attempted,
  heard,
}: {
  takes: ReturnType<typeof useTakes>;
  attempted: boolean;
  heard: boolean;
}) {
  const { t } = useTranslation();
  const { recorder, saving, host, unsaved, unheard, late, silent } = takes;
  return (
    <p className="text-center text-xs text-muted-foreground" aria-live="polite">
      {recorder.state === "recording"
        ? t("speech.recording")
        : silent
          ? t("speech.nothingHeard")
          : saving
            ? host?.recognition
              ? t("speech.listening")
              : t("speech.saving")
            : late
              ? t("speech.heardLater")
              : unsaved
                ? t("speech.notSaved")
                : unheard
                  ? t("speech.notHeard")
                  : attempted
                    ? t("speech.again")
                    : heard
                      ? t("speech.howTo")
                      : null}
    </p>
  );
}

/**
 * Saying it oneself: listen to the original (the item's recording, above), record oneself,
 * play one's take beside it. The item counts once recorded — no self-rating. The phrase to repeat is
 * hidden until the first attempt (the ear first) unless the learner shows it or chose it shown, or
 * there is nothing to hear first.
 */
export function SpeechSelfrate({
  item,
  locale,
  answer,
  onAnswer,
  listen = false,
  heard = true,
  readOnly,
  url,
}: RendererProps<"speech_selfrate">) {
  const lang = useTargetLang();
  const { t } = useTranslation();
  const takes = useTakes(lang, readOnly, onAnswer, {
    expected: linesToSay(item),
    answered: answer !== undefined,
  });
  const { host, take, saving, recorder } = takes;
  const [reveal, setReveal] = useState(false);

  const attempted = answer !== undefined || !!take;
  const textShown = readOnly || !listen || attempted || reveal;
  // The source's own answer, once the learner has tried (their answer first, then the model one).
  const sample =
    item.answerAudio && (readOnly || attempted) ? (
      <TakeButton src={url(item.answerAudio)} label={t("speech.answerSample")} />
    ) : null;

  return (
    <div className="space-y-3">
      {item.text && (
        // "Show the text" over the blurred phrase itself.
        <div className="relative w-fit min-w-40 max-w-full">
          <p
            {...inLang(lang)}
            aria-hidden={!textShown}
            className={cn(
              "whitespace-pre-line font-heading text-2xl font-semibold text-balance transition-[filter]",
              !textShown && "select-none blur-md",
            )}
          >
            {keptTogether(item.text)}
          </p>
          {!textShown && (
            <button
              type="button"
              onClick={() => setReveal(true)}
              className="absolute inset-0 grid place-items-center text-sm font-medium whitespace-nowrap underline pointer-coarse:min-h-11"
            >
              {t("speech.showText")}
            </button>
          )}
        </div>
      )}
      {!item.text && !item.reference && (
        <p className="text-muted-foreground">
          {item.media?.audio || item.media?.video
            ? t("speech.answerHeard")
            : t("speech.answerFree")}
        </p>
      )}
      {/* What it asks is above (the card's prompts); the source's answer to say (a line or its frame)
          marked as such, then the hint. */}
      {item.reference && (
        <div>
          <p className="text-sm text-muted-foreground">{t("speech.answerLine")}</p>
          <p {...inLang(lang)} className="whitespace-pre-line text-lg font-medium text-pretty">
            {keptTogether(item.reference.join("\n"))}
          </p>
        </div>
      )}
      {locale?.hintHtml && (
        <CourseHtml className="text-sm text-muted-foreground" html={locale.hintHtml} />
      )}
      {readOnly ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {answer?.recording && host ? (
            <KeptTake id={answer.recording} label={t("speech.mine")} />
          ) : answer?.rating ? (
            t(`ex.rate.${answer.rating}`)
          ) : answer ? (
            t("speech.recordedNotKept")
          ) : null}
          {sample}
        </p>
      ) : (
        <div className="flex flex-wrap items-start justify-center gap-4">
          <MicButton
            recorder={recorder.state}
            level={recorder.level}
            waiting={heard ? undefined : "speech.listenFirst"}
            onStart={() => void recorder.start()}
            onStop={recorder.stop}
          />
          {take ? (
            <TakeButton
              src={take.url}
              label={t("speech.mineFor", { time: clock(Math.max(1, take.ms / 1000)) })}
              className="mt-1.5"
            />
          ) : (
            answer?.recording && (
              <KeptTake id={answer.recording} label={t("speech.mine")} className="mt-1.5" />
            )
          )}
          {sample && <span className="mt-1.5">{sample}</span>}
        </div>
      )}
      {answer?.transcript !== undefined && !saving && (
        <Heard lang={lang} reference={linesToSay(item)} transcript={answer.transcript} />
      )}
      {!readOnly && <TakeStatus takes={takes} attempted={attempted} heard={heard} />}
    </div>
  );
}

/**
 * Saying a phrase: the phrase shown, the learner says it, and the words heard
 * are checked against it (scored). It needs recognition: without it the microphone says why, and the
 * item is left to skip.
 */
export function SpeechRepeat({
  item,
  answer,
  onAnswer,
  outcome,
  heard = true,
  readOnly,
}: RendererProps<"speech_repeat">) {
  const lang = useTargetLang();
  const { t } = useTranslation();
  const takes = useTakes(
    lang,
    readOnly,
    ({ recording, transcript }) => {
      if (transcript !== undefined)
        onAnswer({ speech: { ...(recording && { recording }), transcript } });
    },
    { byWords: true, expected: [item.text] },
  );
  const { host, take, saving, recorder } = takes;
  // Without recognition, or a language to hear it in, nothing can check the phrase: the item is left
  // to skip, and the microphone says why.
  const unable = !host?.recognition
    ? "speech.needsRecognition"
    : !lang
      ? "speech.languageUnknown"
      : undefined;
  const attempted = answer !== undefined || !!take;
  return (
    <div className="space-y-3">
      <p
        {...inLang(lang)}
        className="whitespace-pre-line font-heading text-2xl font-semibold text-balance"
      >
        {keptTogether(item.text)}
      </p>
      {!readOnly && !outcome && (
        <div className="flex flex-wrap items-start justify-center gap-4">
          <MicButton
            recorder={recorder.state}
            level={recorder.level}
            waiting={heard ? undefined : "speech.listenFirst"}
            blocked={unable}
            onStart={() => void recorder.start()}
            onStop={recorder.stop}
          />
          {take ? (
            <TakeButton src={take.url} label={t("speech.mine")} className="mt-1.5" />
          ) : (
            answer?.speech.recording && (
              <KeptTake id={answer.speech.recording} label={t("speech.mine")} className="mt-1.5" />
            )
          )}
        </div>
      )}
      {answer && !saving && (
        <Heard lang={lang} reference={item.text} transcript={answer.speech.transcript} />
      )}
      {!readOnly && !outcome && <TakeStatus takes={takes} attempted={attempted} heard={heard} />}
    </div>
  );
}

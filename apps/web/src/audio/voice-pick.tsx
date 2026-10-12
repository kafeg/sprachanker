// A language's voice in Settings → Speech → Read aloud: the voices to choose from, automatic
// first, "Listen", and below them the text it reads — a phrase in the language (another one on
// request) or the learner's own; left empty, the phrase. The choice is kept per engine and language.
import type { SettingValue } from "@sprachanker/schema";
import { RefreshCw, Volume2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSetSetting, useSetting } from "@/api/settings.ts";
import { languageName } from "@/i18n/index.ts";
import { Button } from "@/ui/components/button.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select.tsx";
import { Textarea } from "@/ui/components/textarea.tsx";
import { samplesOf } from "./samples.ts";
import { useReadingWait } from "./speaker.ts";

/** The select's value for "the best one there". */
export const AUTO = "auto";
export type Engine = SettingValue<"speech.readEngine">;

/** What "Listen" reads in a language: its phrases, else the language's name in it ("Deutsch"). */
const samplesFor = (lang: string) => {
  const phrases = samplesOf(lang);
  return phrases.length ? phrases : [languageName(lang, lang, true)];
};

/** The voice a profile chose for a language, with an engine, and how to change it. */
export function useChoice(engine: Engine, lang: string) {
  const set = useSetSetting();
  const chosen = useSetting("speech.voices");
  const own = chosen?.[engine] ?? {};
  return {
    own,
    choose(id: string) {
      const next = { ...own };
      if (id === AUTO) delete next[lang];
      else next[lang] = id;
      set.mutate({ key: "speech.voices", value: { ...chosen, [engine]: next } });
    },
  };
}

export function VoicePick({
  lang,
  pick,
  onListen,
}: {
  lang: string;
  /** The voices to choose from for this language. */
  pick: {
    options: Array<{ id: string; name: string }>;
    value: string;
    /** The name of the voice "automatic" reads with. */
    auto: string;
    onChange(id: string): void;
  };
  onListen(text: string): void;
}) {
  const { t, i18n } = useTranslation();
  const name = languageName(lang, i18n.language, true);
  const phrases = samplesFor(lang);
  const [shown, setShown] = useState(0);
  const phrase = phrases[shown % phrases.length] ?? "";
  const [text, setText] = useState(phrase);
  // The server's voice taking its time over "Listen" (a model loading): said.
  const starting = useReadingWait() === `listen:${lang}`;
  const another = () => {
    const next = (shown + 1) % phrases.length;
    setShown(next);
    setText(phrases[next] ?? "");
  };
  return (
    <>
      <Select value={pick.value} onValueChange={pick.onChange}>
        <SelectTrigger
          className="min-w-56 flex-1"
          aria-label={t("speech.settings.voiceFor", { language: name })}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO}>
            {t("speech.settings.voiceAuto", { name: pick.auto })}
          </SelectItem>
          {pick.options.map((v) => (
            <SelectItem key={v.id} value={v.id}>
              {v.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="sm"
        loading={starting}
        onClick={() => onListen(text.trim() || phrase)}
      >
        {!starting && <Volume2 className="size-4" />} {t("speech.settings.listen")}
      </Button>
      {starting && (
        <span className="text-sm text-muted-foreground" role="status">
          {t("speech.starting")}
        </span>
      )}
      <div className="basis-full space-y-1 sm:ps-31">
        <Textarea
          lang={lang}
          dir="auto"
          rows={2}
          className="min-h-0"
          aria-label={t("speech.settings.sampleFor", { language: name })}
          placeholder={phrase}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {phrases.length > 1 && (
          <Button variant="link" size="sm" className="h-auto px-0 py-0" onClick={another}>
            <RefreshCw className="size-3.5" /> {t("speech.settings.otherSample")}
          </Button>
        )}
      </div>
    </>
  );
}

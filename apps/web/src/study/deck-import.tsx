// Importing a deck file (.apkg) in Review → Decks (09): the file chosen, the server's preview of it, then
// a side panel to name the deck and say its languages — the words' (the learner's courses' here, else
// German) and the translations' (the interface's) — with its first words, and Import.
import { Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDecks } from "@/api/cards.ts";
import { type DeckPreview, previewDeck, useImportDeck } from "@/api/decks.ts";
import { languageName } from "@/i18n/index.ts";
import { Button } from "@/ui/components/button.tsx";
import { Input } from "@/ui/components/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select.tsx";
import { errorText } from "@/ui/error-text.ts";
import { SideSheet } from "@/ui/side-sheet.tsx";

/** The languages offered: the interface's and those of the learner's decks, besides the common ones. */
const COMMON = ["de", "en", "ru"];

export function DeckImport() {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<{ file: File; preview: DeckPreview }>();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<unknown>();
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(undefined);
    setReading(true);
    try {
      setChosen({ file, preview: await previewDeck(file) });
    } catch (e) {
      setError(e);
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div className="space-y-1">
      <input
        ref={input}
        type="file"
        accept=".apkg"
        className="hidden"
        aria-label={t("decks.import.button")}
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      <Button variant="outline" loading={reading} onClick={() => input.current?.click()}>
        <Upload /> {t("decks.import.button")}
      </Button>
      {error !== undefined && <p className="text-sm text-wrong">{errorText(t, error)}</p>}
      {chosen && (
        <DeckImportSheet
          file={chosen.file}
          preview={chosen.preview}
          onClose={() => setChosen(undefined)}
        />
      )}
    </div>
  );
}

/** The chosen file's deck: its name, languages and first words, and Import. */
export function DeckImportSheet({
  file,
  preview,
  onClose,
}: {
  file: File;
  preview: DeckPreview;
  onClose(): void;
}) {
  const { t, i18n } = useTranslation();
  const known = (useDecks().data?.decks ?? []).map((d) => d.language);
  const importDeck = useImportDeck();
  const nameId = useId();
  // A deck here the file updates keeps its name and languages unless changed.
  const { updates } = preview;
  const [title, setTitle] = useState(
    updates?.title || preview.title || file.name.replace(/\.apkg$/i, ""),
  );
  const [lang, setLang] = useState(updates?.lang ?? known[0] ?? "de");
  const [translationLang, setTranslationLang] = useState(updates?.translationLang ?? i18n.language);
  const updating = updates && updates.lang === lang && updates.translationLang === translationLang;
  const languages = [...new Set([...COMMON, i18n.language, ...known])].sort();
  const language = (label: string, value: string, set: (v: string) => void) => (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <Select value={value} onValueChange={set}>
        <SelectTrigger className="h-11 w-full bg-card" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {languages.map((code) => (
            <SelectItem key={code} value={code}>
              {languageName(code, i18n.language, true)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  return (
    <SideSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={t("decks.import.title")}
      className="overflow-y-auto sm:max-w-md"
    >
      <form
        className="space-y-4 px-4 pb-6"
        onSubmit={(e) => {
          e.preventDefault();
          importDeck.mutate(
            { file, title: title.trim(), lang, translationLang },
            { onSuccess: onClose },
          );
        }}
      >
        <p className="text-sm text-muted-foreground">
          {updating ? t("decks.import.updates", { deck: updates.title }) : t("decks.import.hint")}
        </p>
        <div className="space-y-1">
          <label htmlFor={nameId} className="text-sm text-muted-foreground">
            {t("decks.import.name")}
          </label>
          <Input
            id={nameId}
            value={title}
            maxLength={200}
            required
            onChange={(e) => setTitle(e.target.value)}
            className="h-11"
          />
        </div>
        {language(t("decks.import.lang"), lang, setLang)}
        {language(t("decks.import.translationLang"), translationLang, setTranslationLang)}
        <section>
          <h3 className="mb-1 font-semibold">
            {t("decks.import.words", { words: preview.words, audio: preview.withAudio })}
          </h3>
          <ul className="divide-y rounded-xl border text-sm">
            {preview.first.map((w) => (
              <li key={w.target} className="flex gap-2 px-3 py-2">
                <span lang={lang} className="font-medium">
                  {w.target}
                </span>
                {w.translation && <span className="text-muted-foreground">· {w.translation}</span>}
              </li>
            ))}
          </ul>
        </section>
        {importDeck.isError && (
          <p className="text-sm text-wrong">{errorText(t, importDeck.error)}</p>
        )}
        <Button type="submit" size="lg" loading={importDeck.isPending} disabled={!title.trim()}>
          {t("decks.import.submit")}
        </Button>
      </form>
    </SideSheet>
  );
}

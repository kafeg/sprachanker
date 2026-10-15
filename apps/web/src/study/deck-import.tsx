// Importing a deck file in Review → Decks: the file chosen and uploaded once, the server's preview of
// it, then a side panel. An .apkg: to name the deck and say its languages — the words' (the first its
// fields are named by, else the learner's decks', else German) and the translations' (of those the
// deck has, the interface's when it is one) — with its first words, and Import by the upload's id. A
// deck file of the app's own (.sprachanker-deck: a deck exported with its audio and examples): what
// it holds and where it goes, and Import.

import { DECK_BUNDLE_EXTENSION } from "@sprachanker/schema";
import { Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDecks } from "@/api/cards.ts";
import {
  type DeckFilePreview,
  type DeckPreview,
  discardDeckUpload,
  previewDeck,
  useImportDeck,
  useImportDeckFile,
} from "@/api/decks.ts";
import { languageName } from "@/i18n/index.ts";
import { Button } from "@/ui/components/button.tsx";
import { Input } from "@/ui/components/input.tsx";
import { inLang, isolate } from "@/ui/direction.tsx";
import { errorText } from "@/ui/error-text.ts";
import { SelectField } from "@/ui/select-field.tsx";
import { SideSheet } from "@/ui/side-sheet.tsx";

/** The languages offered: the interface's and those of the learner's decks, besides the common ones. */
const COMMON = ["de", "en", "ru"];

/** What an import made: the deck's name and words, and the notes of a package it left out. */
type Imported = {
  title: string;
  words: number;
  left?: { withoutWord: number; unusable?: number; joined?: number };
};
/** A file chosen and previewed: a package (.apkg), or a deck file of the app's own. */
type Chosen = { file: File; preview: DeckPreview } | { file: File; deckFile: DeckFilePreview };

export function DeckImport() {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<Chosen>();
  const [imported, setImported] = useState<Imported>();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<unknown>();
  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(undefined);
    setImported(undefined);
    setReading(true);
    try {
      // Which kind of file it is the server tells by its content.
      const preview = await previewDeck(file);
      setChosen("kind" in preview ? { file, deckFile: preview } : { file, preview });
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
        accept={`.apkg,${DECK_BUNDLE_EXTENSION},.zip`}
        className="hidden"
        aria-label={t("decks.import.button")}
        onChange={(e) => void choose(e.target.files?.[0])}
      />
      <Button variant="outline" loading={reading} onClick={() => input.current?.click()}>
        <Upload /> {t("decks.import.button")}
      </Button>
      {error !== undefined && <p className="text-sm text-wrong">{errorText(t, error)}</p>}
      {imported && (
        <p className="text-sm text-muted-foreground" role="status">
          {t("decks.import.done", { deck: isolate(imported.title), words: imported.words })}{" "}
          {imported.left && <LeftOut left={imported.left} />}
        </p>
      )}
      {chosen && "deckFile" in chosen && (
        <DeckFileSheet
          preview={chosen.deckFile}
          onClose={(result) => {
            setChosen(undefined);
            setImported(result);
          }}
        />
      )}
      {chosen && "preview" in chosen && (
        <DeckImportSheet
          file={chosen.file}
          preview={chosen.preview}
          onClose={(result) => {
            setChosen(undefined);
            setImported(result);
          }}
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
  /** Closed: with what was imported, or without (the uploaded file let go). */
  onClose(imported?: Imported): void;
}) {
  const { t, i18n } = useTranslation();
  const known = (useDecks().data?.decks ?? []).map((d) => d.language);
  const importDeck = useImportDeck();
  const nameId = useId();
  // A deck here the file updates keeps its name and languages unless changed (the first, when the
  // file is several decks here in other languages); the languages its fields are named by come
  // first: the first the words', the others their translations'.
  const { languages: own } = preview;
  const [kept] = preview.updates;
  const [title, setTitle] = useState(
    kept?.title || preview.title || file.name.replace(/\.apkg$/i, ""),
  );
  const all = [...new Set([...COMMON, i18n.language, ...known, ...own])].sort();
  // The translations' languages: those the deck's fields name, else any — never the words' own.
  const translationsFor = (words: string) =>
    (own.length > 1 ? own : all).filter((l) => l !== words);
  const [lang, setLang] = useState(kept?.lang ?? own[0] ?? known[0] ?? "de");
  const translations = translationsFor(lang);
  const [translationLang, setTranslationLang] = useState(
    kept?.translationLang ??
      (translations.includes(i18n.language) ? i18n.language : (translations[0] as string)),
  );
  const chooseLang = (next: string) => {
    setLang(next);
    if (!translationsFor(next).includes(translationLang))
      setTranslationLang(translationsFor(next)[0] as string);
  };
  const updating = preview.updates.find(
    (d) => d.lang === lang && d.translationLang === translationLang,
  );
  const language = (label: string, value: string, set: (v: string) => void, options: string[]) => (
    <SelectField
      label={label}
      value={value}
      options={options.map((code) => [code, languageName(code, i18n.language, true)])}
      onChange={set}
    />
  );
  return (
    <SideSheet
      open
      onOpenChange={(open) => {
        // Closed unimported: the uploaded file goes.
        if (open) return;
        void discardDeckUpload(preview.upload);
        onClose();
      }}
      title={t("decks.import.title")}
      className="overflow-y-auto sm:max-w-md"
    >
      <form
        className="space-y-4 px-4 pb-6"
        onSubmit={(e) => {
          e.preventDefault();
          importDeck.mutate(
            {
              upload: preview.upload,
              title: title.trim(),
              lang,
              translationLang,
              file: file.name,
            },
            { onSuccess: (result) => onClose(result) },
          );
        }}
      >
        <p className="text-sm text-muted-foreground">
          {updating ? t("decks.import.updates", { deck: updating.title }) : t("decks.import.hint")}
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
        {language(t("decks.import.lang"), lang, chooseLang, all)}
        {language(
          t("decks.import.translationLang"),
          translationLang,
          setTranslationLang,
          translations,
        )}
        <section>
          <h3 className="mb-1 font-semibold">
            {t("decks.import.words", {
              words: preview.words,
              audio: preview.withAudio,
              examples: preview.withExamples,
            })}
          </h3>
          <p className="mb-2 text-sm text-muted-foreground">
            <LeftOut left={preview.left} />
          </p>
          <ul className="divide-y rounded-xl border text-sm">
            {preview.first.map((w) => {
              const translation = w.translations[translationLang] ?? w.translations[""];
              return (
                <li key={w.target} className="flex gap-2 px-3 py-2">
                  <span {...inLang(lang)} className="font-medium">
                    {w.target}
                  </span>
                  {translation && <span className="text-muted-foreground">· {translation}</span>}
                </li>
              );
            })}
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

/** A deck file of the app's own: its deck's name, language and words (with audio, with examples),
 *  what becomes of them here, and Import. */
export function DeckFileSheet({
  preview,
  onClose,
}: {
  preview: DeckFilePreview;
  /** Closed: with what was imported, or without (the uploaded file let go). */
  onClose(imported?: Imported): void;
}) {
  const { t, i18n } = useTranslation();
  const importFile = useImportDeckFile();
  const title = preview.kind === "finds" ? t("decks.finds") : preview.title;
  const what =
    preview.kind === "course"
      ? preview.waits
        ? t("decks.file.courseWaits")
        : t("decks.file.course")
      : preview.kind === "finds"
        ? t("decks.file.finds")
        : preview.merges
          ? t("decks.file.merges")
          : t("decks.file.new");
  return (
    <SideSheet
      open
      onOpenChange={(open) => {
        if (open) return;
        void discardDeckUpload(preview.upload);
        onClose();
      }}
      title={t("decks.import.title")}
      className="overflow-y-auto sm:max-w-md"
    >
      <div className="space-y-4 px-4 pb-6">
        <section>
          <h3 className="font-semibold">
            <bdi>{title}</bdi>
          </h3>
          <p className="text-sm text-muted-foreground">
            {languageName(preview.lang, i18n.language, true)} ·{" "}
            {t("decks.import.words", {
              words: preview.words,
              audio: preview.withAudio,
              examples: preview.withExamples,
            })}
          </p>
        </section>
        <p className="text-sm text-muted-foreground">{what}</p>
        {importFile.isError && (
          <p className="text-sm text-wrong">{errorText(t, importFile.error)}</p>
        )}
        <Button
          size="lg"
          loading={importFile.isPending}
          onClick={() =>
            importFile.mutate(preview.upload, {
              onSuccess: (result) => onClose({ title, words: result.words }),
            })
          }
        >
          {t("decks.import.submit")}
        </Button>
      </div>
    </SideSheet>
  );
}

/** The notes a deck file's import leaves out, and why, and those joined to a word already in it;
 *  nothing when none. */
function LeftOut({ left }: { left: { withoutWord: number; unusable?: number; joined?: number } }) {
  const { t } = useTranslation();
  return [
    left.withoutWord > 0 && t("decks.import.left", { count: left.withoutWord }),
    !!left.unusable && t("decks.import.unusable", { count: left.unusable }),
    !!left.joined && t("decks.import.joined", { count: left.joined }),
  ]
    .filter(Boolean)
    .join(" ");
}

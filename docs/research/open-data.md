# Open data and similar tools (research, 2026-10-10)

What other projects and datasets offer SprachAnker, read from their pages on 2026-10-10. Nothing here
is imported yet; each source's terms are to be checked again before an importer is written.

## Similar tools

- **awesome-german/learning-tools** (CC BY 4.0 link list): mostly commercial apps; its desktop apps
  are Anki and Rosetta Stone. No self-hosted course app like ours.
- **LUTE v3** (github.com/LuteOrg/lute-v3, MIT): self-hosted learning by reading — texts, terms with
  their root forms, word images. The closest relative in spirit (our "Books" item); LWT is its older
  PHP form.
- **LanguageTool** (open source, runs as a local server): could point out errors in written answers
  offline, beside the AI.

## Open data worth an importer

| Source | What | Terms | Format |
|---|---|---|---|
| Tatoeba (tatoeba.org/en/downloads) | sentences with translations, native audio | sentences CC BY 2.0 FR (a CC0 subset); audio per contributor — none given means no reuse | TSV per language, `sentences_with_audio` with author and licence |
| Wiktionary via kaikki.org | German words: senses, gender, plural, inflection, IPA | Wiktionary CC BY-SA; cite Ylonen 2022 | JSONL (raw wiktextract data) |
| german-nouns (github.com/gambolputty/german-nouns) | ~100k nouns with gender and all cases | CC BY-SA 4.0 | CSV |
| FrequencyWords (github.com/hermitdave/FrequencyWords) | word frequencies from subtitles | content CC BY-SA 4.0 | `de_50k.txt` |
| DWDS (dwds.de/d/api) | frequency, IPA, lemma lists | its own terms; its Goethe A1–B1 lists are © Goethe-Institut | API, CSV/JSON |
| Project Gutenberg, LibriVox | public-domain books and audiobooks | public domain (US) | EPUB/TXT, MP3 |

Textbook word lists (Menschen, Schritte, Netzwerk) are sold by their publishers; none is open. A way
that ships nothing of theirs: the learner's own list of a chapter, enriched locally from the open data.

## Not usable

- **github.com/Hazrat-Ali9** (564 repos, 26 about German): PDFs of commercial textbooks and handouts
  collected from social media groups (their READMEs say so), at least one pirated book; no LiD,
  driving test or placement data; no licence over the content. Not a second source for anything.

# Research — Lingust «Правильный английский»

Facts observed on `lingust.ru` (October 2026); the importer is `courses/lingust-english` (spec 03 §4).

## Site and licence

- Index: `https://lingust.ru/english/english-lessons` — stages ЭТАП 1–3 (lessons 1–13, 14–30, 31–52) and
  a bonus block (`irregular-verbs`, `dialogue1` — content moved to the mobile app, `right-english` —
  about the course). Lessons are `/english/english-lessons/lessonN`.
- © Lingust 2011–2026, free to read online, no open licence. robots.txt allows lesson pages and
  `/media/`, disallows `/images/` (and Joomla system paths).
- MP3s at `/media/sound/eng/course/lessonN/*.mp3` answer 403 without a `Referer` from the site
  (hotlink protection). From lesson 14 most players are locked for paying users (`cplayer-lock`, ~386).

## Page structure

- Flat Joomla article: `h1` title; sections under `h2`/`h3`/`h4` (`tac bbgc-*` classes); players
  `<div class="cplayer" data-src="…mp3">` next to example lines (English, then Russian).
- «Словарь»: rows with headword, IPA (`/gɪv/`), Russian translation; «v./adj./n.» marks the part of
  speech, «прош./прич.» give verb forms.
- Exercises «Упражнение N.» (lessons 47+: «Exercise N»): `<input>` gaps in English sentences (a
  `readonly` first item is the example), `<input class="form-control">` translation fields,
  `<select>` gaps, textareas, check boxes.
- Answer keys: a key icon in an element with `data-tooltips-content` (HTML) and
  `data-tooltips-title="Упражнение N"`; lines `N. <strong>answers</strong>: перевод`, «а)/б)» sub-items,
  `/` alternatives, «–» = no article.

## Counts (import of October 2026)

4 units, 53 lessons, 176 grammar pages, 2416 words; exercises: speech_selfrate 134, respond 78, gap_text 16,
gap_choice 3, unknown 30; 215 MP3s (53 MB).

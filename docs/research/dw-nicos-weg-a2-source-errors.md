# Research — DW Nicos Weg A2 (ru-de): the source's own errors

Content errors found in a screenshot QA pass of A2 `ru-de` (October 2026), each checked against the stored
raw page (`raw/ru-de/a2/e-<id>.json`; a lesson's grammar and culture tabs are in every page of the lesson
and in `l-<id>.json`) so that it is DW's text, not a normaliser's. Keys are `dw.nicos-weg/a2-ru/<lesson>/ex-NN`;
"page" is the exercise's 0-based position among the lesson's pages, as the app counts them; "grammar N"
is the lesson's N-th grammar tab.

## Errors in the source (verified in raw), fixed

Fixed by the DW normaliser's corrections, `courses/dw/src/normalise/corrections.json` (spec 03,
"Corrections"): each applies while DW's phrase is still there, and is reported stale once DW changes it.

| Exercise | Page | What is wrong |
|---|---|---|
| `01-02/ex-03` | 2 | Hint #4: "в офисе банке" for "в офисе банка". |
| `02-03/ex-10` | 9 | "впиши в пропуски", but the gaps take given words (a bank); nothing is typed. |
| `02-04/ex-06` | 5 | "Расположи предложения …", but each item orders the parts of one sentence ("Bring die Satzteile …"). |
| `03-03/ex-09` | 8 | "Выбери правильный ответ" (one), but three of six are right ("Drei Sätze sind richtig"). |
| `04-01/ex-01` | 0 | Hint: "При коллективном испитии" for "распитии". |
| `04-03/ex-08` | 7 | "при покупке билет на поезд" for "билета". |
| `04-04/ex-03` | 2 | Hint: "с одного поезд на другой" for "поезда". |
| `05-01/ex-12` | 11 | "Впиши в пропуски", but the gaps take given words. |
| `06-03/ex-04` | 3 | "Каких глаголов не хватает?", but one answer is the adjective "sicher". |
| `08-04/ex-08` | 7 | Hint #2: "господин Шлемммер" (the same hint writes "Шлеммера"). |
| `10-03/ex-07` | 6 | Title "…: винительный падеж" and "Здесь они управляют винительным падежом", but half the gaps answer "Wo?" (dative); DW's German says "im Dativ und Akkusativ". |
| `11-01/ex-11` | 10 | "расположи слова в предложении …", but the items pair sentence starts with "sondern …" endings. |
| `14-04/ex-10` | 9 | Item #2: "Скажи, что ты пришел домой" — the learner plays Yara. |
| `15-01/ex-10` | 9 | Hint #4: "Viel Glück" glossed as "пожелание счастья" and "Viel Erfolg" as "пожелание удачи" (luck, success). |
| `15-04/ex-01` | 0 | Hint #3 calls "Lieblings-" an "Эпитет"; it is the first part of a compound. |
| `16-02/ex-02` | 1 | Hint #4: "Regieanweisung" means "режиссура"; it is a stage direction. |
| `18-01/ex-07` | 6 | "На занятиях немецким Нико …" — "языком" missing. |
| `18-01/ex-08` | 7 | Hint: "19 Jahrhundert" without the ordinal's dot. |
| `18-03/ex-05` | 4 | "добавь по два правильных их окончания" — stray "их". |
| `18-04/ex-04` | 3 | "Ответь на вопросы" over one question. |
| `18-04/ex-08` | 7 | "не только для образования … Perfekt, но и в страдательном залоге" — halves do not match. |
| `19-01/ex-20` | 19 | "реши, правильно ли использованы слова …", but the learner fills gaps with them. |

## Errors in the source (verified in raw), open

Corrections reach only an exercise's Russian texts (title, instruction, stimulus text, an item's prompt
or hint). These are in a lesson's grammar or culture tab, or in German texts the canonical file holds
(options, prompts, dialogue), or are not text errors.

Grammar and culture tabs:

| Lesson, tab | What is wrong |
|---|---|
| `00-02` grammar 4 | "придаточного предожения". |
| `04-02` culture | "накрывают столы для завтрака ресторанах отеля" — "в" missing. |
| `06-02` grammar 1 | "etwas, nichts и alles … указывают на живые существа, предметы и явления" — they do not refer to living beings. |
| `06-04` grammar 1 | The example "stehen: Der Pullover steht der Frau." twice in a row (the raw page has it twice). |
| `07-04` grammar 1 | "Косвенная речь используются". |
| `08-01` grammar 1, `16-01` grammar 1 | Relative clauses as part of a "сложносочиненного предложения" (сложноподчиненного). |
| `08-03` grammar 1 | "придаточные определительные предложениях". |
| `09-02` culture | "Популярность пользуются" (Популярностью). |
| `11-01` culture | "работать на удалении" (удаленно). |
| `12-03` grammar 1 | Table of "haben": "es/sie/es hätte" for "er/sie/es". |
| `13-01` culture | "Культурная жизнь Германия богата" (Германии). |
| `13-03` grammar 1 | Tables of "wandern" and "arbeiten": the 3rd-person rows labelled "2-е лицо". |
| `14-01` culture | "немцы отмечает". |
| `14-03` grammar 2 | "Господин Бальдер"; the exercises say "Herr Baldner". |
| `15-01` grammar 1 | Example "ich gebe ihr eine DVD." starts lower case. |
| `15-03` grammar 1 | Row label "3rd person" (English) in a Russian table. |
| `16-02` grammar 1 | Genitive table, plural row: "Tonassistenten" without "die" (the other rows give the article). |

German texts and structure:

| Exercise | Page | What is wrong |
|---|---|---|
| `04-04/ex-05`, `ex-07` | 4, 6 | The man is "Herr Meiers" everywhere but "Herr Meier" in `ex-05` item 6. |
| `04-04/ex-07` | 6 | Option "Hin-und Rückfahrt" (space missing). |
| `07-02/ex-05` | 4 | Item 2: "Schreib das passende Wort … In jede Lücke passt ein Wort." over choices of whole phrases. |
| `07-03/ex-02` | 1 | Option "Bin schon da." before the text's own full stop: "da..". |
| `09-02/ex-03`, `11-02/ex-01` | 2, 0 | "Jaques" for "Jacques" (an option; two order parts). |
| `09-03/ex-06` | 5 | Item 2: "Günter" for "Günther". |
| `10-01/ex-06` | 5 | "für das gleicheGeld" (space missing in raw). |
| `12-03/ex-03` | 2 | "Ich möchte mit Herr/Frau … sprechen" (Herrn). |
| `16-04/ex-05` | 4 | Item 3: option "Falsc". |
| `14-04/ex-06` | 5 | The sentence "Sag mal, erinnerst du dich … die blond… Frau …" ends item 1 and starts item 2 (two DW clozes): its two gaps are asked twice. |

Not verified (need the video or the picture): `01-02/ex-05` (page 4) — a girocard ("BANK-KARTE") keyed
as "Kreditkarte", against `ex-04`; `07-02/ex-01` (page 0) — the key "Er möchte ihr nicht helfen …".

## Source as designed (verified in raw; not errors)

- `02-04/ex-02`, `ex-03`: "Selma: Frau Kohlhaas? / Inge: Ach, Inge!" — Inge asks to be called by her
  first name (the episode script has the same).
- Speaking items whose question is only in the audio (DW's text is "Прослушать аудио" and a frame such as
  "Ja, … / Nein, …"): `11-02/ex-09`, `14-02/ex-06`, `ex-09`, `ex-10`, also `07-01/ex-10`, `11-04/ex-04`,
  `15-01/ex-04`, `15-04/ex-10`.
- `02-04/ex-11` "В подсказках приводятся примеры …" and `05-02/ex-11` "по заданному образцу": DW's items
  have no hint text; the examples are the answer audio.
- `05-03/ex-03`: the text names six feelings, DW has five photos; "Wie fühlt Emma sich?" is both in DW's
  text and its question. `05-03/ex-08`: "vier Antworten" in the text, three audio items in DW.
- Tips that ask for practice beyond the page: `00-03/ex-03` #1, `05-01/ex-13` #2, `10-04/ex-05` #3,
  `10-04/ex-11` #1 ("Обсудите" — to a group of learners).
- `03-03/ex-04` #1 (Mama/Mutti — words of the video), `12-03/ex-05` #3 (the related "slower" request),
  `04-04/ex-09` (reminds the ihr-imperative; the pairs mix du/Sie/ihr on purpose), `13-03/ex-05` ("здесь
  не рассматриваем" — the items), `11-03/ex-02` (the hint paraphrases the option).
- `01-03/ex-05` "Find die Paare" — DW's short imperative, as "Wähl", "Schreib".
- Debatable wording, kept: `14-03/ex-08` title "Что вы делаете …? (2)" (a radio show to its listeners),
  `17-02/ex-06` "подходящий эпитет", "с твоими партнерами" (`10-01/ex-07`, `15-02/ex-05`, `15-03/ex-10`,
  `15-04/ex-06`; with «ты» both «свой» and «твой» are accepted).

Typography, not corrected (a pattern across the course): «е» for «ё», straight or mixed quotes, a hyphen
for a dash, missing commas, four dots "…." and a doubled stop "."." (`00-03/ex-11`, `10-04/ex-08`,
`18-04/ex-07`, `10-04/ex-05`), missing spaces ('Глагол"würden"', "Musical„Evita“", '"jemandem
passen"(подходить)'), options or prompts without their final stop or "?", "Jacques‘" with a left quote.

## Reported but not confirmed

- `00-03` grammar 1 "выражении" and `01-04/ex-05` "образует": the text has "выражений", "образуют".
- `19-01/ex-10` (page 9): "Nico: Genau." — the data and the screen read "Nina: Genau.".
- `08-03/ex-01`: "Wähl die richtigen Aussagen." without "aus" — "wählen" alone is correct.
- `09-01/ex-08`: "идут в "Марек" вместе" — the party is at Marek, Max and Tarek's restaurant.

## Ours, not the source's

- A vocabulary chip glued to the rest of its word gets a space: "Schlangen fleisch", "Lamm fleisch",
  "Frosch beinen" (`08-02/ex-06`), "Massage - Gutschein" (`15-02/ex-07`), "Wellness -Hotel"
  (`15-03/ex-06`); raw: `<span …>Massage</span>-<span …>Gutschein</span>`.
- DW's new-word marks (VOCABULARY spans) dropped from a text whose instruction points to them:
  `04-03/ex-03`, `07-04/ex-02`.
- `02-03/ex-06` (page 5): the Russian instruction ("Соедини в пары слова и картинки.") is in the locale
  file but not shown on the step.
- Speaking items whose prompt is the learner's own line to read aloud: `06-01/ex-12`, `10-02/ex-09`.
- `12-03`, `12-04`: grammar steps titled "· часть 2" with no part 1 in the lesson; `12-03` grammar 2 card
  cut at the bottom (the text is complete); `15-01`: 18 words in the summary, 17 in the words step.

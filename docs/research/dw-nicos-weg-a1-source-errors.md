# Research — DW Nicos Weg A1 (ru-de): the source's own errors

Content errors found in a QA pass of A1 `ru-de` (October 2026), each checked against the stored raw
page (`raw/ru-de/a1/e-<id>.json`) so that it is DW's text, not a normaliser's. Keys are `dw.nicos-weg/a1-ru/<lesson>/ex-NN`;
"page" is the exercise's 0-based position among the lesson's pages, as the app counts them.

## Errors in the source (verified in raw)

Every error in this table is fixed by the DW normaliser's corrections,
`courses/dw/src/normalise/corrections.json` (spec 03, "Corrections"): each applies while DW's phrase is
still there, and is reported stale once DW changes it.

| Exercise | Page | What is wrong |
|---|---|---|
| `12-04/ex-10` | 9 | Title "Рис с овощами и мясом", but the ingredients and the recipe are fish ("500 g Fisch", "Den Fisch …"). |
| `00-03/ex-11` | 10 | Hint says every word at the start of a sentence is capitalised ("все слова пишутся с большой буквы"); only the first word is. |
| `01-02/ex-04` | 3 | The same wrong hint. |
| `08-02/ex-01` | 0 | Instruction "Какое из трех утверждений правильное? Выбери ответ." (one of three), but it is a multiple choice of six with three right ("Drei Aussagen sind richtig"). |
| `08-04/ex-02` | 1 | The info box above the questions (`inputText`) summarises the scene and gives both answers away (late because of a traffic jam; Inge offers Nico a room). |
| `08-04/ex-12` | 11 | "Впиши в пропуски услышанное", but it is a dictation of whole sentences: there are no gaps. |
| `03-03/ex-13` | 12 | "Расположи слова в правильной последовательности", but the items are typed gaps (cloze, writing), not words to order. |
| `03-04/ex-01` | 0 | Hint: the euro is the currency of "19 государств" of the EU — outdated (20 since 2023, 21 since 2026). |
| `04-03/ex-07` | 6 | Rule text "Эта та же форма" for "Это та же форма". |
| `06-04/ex-15` | 14 | Task "Скажи, что ванной комнате много света" — "в" missing ("что в ванной комнате"). |
| `13-01/ex-07` | 6 | Instruction refers to "Мужчина из видео", but the page has no clip (the episode is on `ex-01`; corrected to the lesson's video). |

## Source as designed (verified in raw; not errors)

- `03-01/ex-09` (page 8, "Друг Себастиана"): the picture shows Sebastian himself — it is the exercise's
  own picture (`mainContentImage`, DW's caption names Sebastian), not a mix-up of ours.
- `04-01/ex-11` (page 10): cards 3–5 read only "Ja, ich war… / Nein, ich war…" — the city is asked in
  the audio; the card is the answer's frame (kept, unlike tasks of only "…").
- `07-02/ex-17` (page 16): the instruction ends with a question to the learner ("Что происходит при
  отрицательном ответе на вопрос?"); the description is complete, not cut.
- `14-02/ex-04`, `ex-07` (pages 3, 6): titles "Цвета: куртка…", "Эта футболка…" end with an ellipsis
  in the source.
- Instructions that mention "the video" without a clip on the page refer to the lesson's episode:
  `00-04/ex-10`, `06-02/ex-06`, `07-04/ex-05`, `16-01/ex-12`, `16-04/ex-04`, `16-04/ex-13`.

## Reported but not confirmed

- `16-01/ex-12` (page 11): the text names Daniel ("Daniel ist gegen das Tor gelaufen …") and every
  pair matches it (Tarek–Knie, Robert–Auge, Linus–Bein, Daniel–Schulter).
- `16-02/ex-02` vs `ex-03`: consistent — "zweimal pro Monat" there, "Zweimal im Monat" the right
  answer here; "Zweimal in der Woche" is a wrong option.
- `04-04/ex-02` (page 1): the options read "Spanisch" in the raw page and our files, not "Spanish".

## Ours, not the source's

- Glued words next to vocabulary chips ("Wir lernenDeutsch.", "einePause .", "Umzug– Nico" in
  `06-01/ex-16`), double spaces and spaces before punctuation: fixed in the normaliser (spec 03).
- Clips on items not shown ("watch the clip again" without a player) and speaking tasks of only "…":
  fixed in the normaliser (spec 03).
- Mixed ты/вы: DW writes to the learner with ты; the app's own Russian strings use вы ("Послушайте и
  ответьте вслух." under the speaking card, `apps/web/src/i18n/ru.json`).

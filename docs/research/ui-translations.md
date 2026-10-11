# UI translations: choices to check with native speakers

The catalogs beyond en/ru/de (`apps/web/src/i18n/*.json`) were translated with a model and checked by
`apps/web/test/catalogs.test.ts` (keys, ICU, arguments, plural categories, nothing left as English
unless allowed per language). No native speaker has read them yet. Each language addresses the
learner as DW's Nicos Weg edition in that language does. Below: per language, the choices a native
speaker should confirm first.

Common to all: the macOS menu path in `speech.settings.betterVoices` (written from memory, or left in
English where macOS has no such localisation), the short interval units of the review (`study.unit`),
the profile and flag colour names.

| Lang | Register | Check first |
|---|---|---|
| ar | masculine singular imperative | رزمة (deck), duals in count-less labels, عَلَقة (leech), interval abbreviations; Latin digits (as `Intl` gives) |
| bs | ti, ijekavian (as DW) | Sveska (Notebook), Pauziraj / Odloži (suspend / bury), cjelina (unit), "Endpoint" in English |
| el | εσύ, monotonic, «;» | μάθημα = course, ενότητα = lesson; "Ξανά ο ήχος" (replay) |
| es | tú, neutral Latin American | computadora vs ordenador (DW mixes both), apartado (item), vuelta (pass), Posponer (bury) |
| fa | تو, Persian digits, ZWNJ | دور (pass) next to دوره (course), نمایه vs پروفایل, تمرین for both exercise and exam practice |
| fr | tu | "Prompt" kept, élément (item), short headers Nouv. / Appr. / Rév. |
| hi | तुम, DW's spelling (no nukta, "." not "।") | अध्याय (unit), दौर (pass), दोहराव (Review), state names from English |
| hu | te | "MI" for AI, kör (pass), részfeladat (item), makacs kártya (leech) |
| id | kamu | Bab (unit), Pengulangan (Review), putaran (pass) |
| pl | ty, gendered past forms avoided | fiszka vs karta (card), Rozdział (unit), "Do powt." |
| pt | você (Brazilian, as DW's pt edition) | rodada (pass), Adiar (bury); `=0` branches added (CLDR puts 0 in `one`) |
| ro | tu, ș ț with comma below | amână (bury), "l" for months, colour names |
| sw | wewe | seti (deck), igizo (scene), mzunguko (pass), agreement of wasifu |
| tr | sen | "Mevcut" (Available tab), Uç nokta (endpoint), YZ as the short AI label |
| uk | ти, translated from English | Ендпоінт / Промпт, short headers, "Пристрої, де виконано вхід" |
| zh | 你, Simplified, no spaces between Chinese and Latin | 学习记录 (Notebook), 辅导老师 (tutor), 轮 (pass), 难记 (leech) |

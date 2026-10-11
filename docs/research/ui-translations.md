# UI translations: choices to check with native speakers

The catalogs beyond en/ru/de (`apps/web/src/i18n/*.json`) were translated with a model and checked by
`apps/web/test/catalogs.test.ts` (keys, ICU, arguments, numbers as `{n, number}`, plural categories,
nothing left as English unless allowed per language). No native speaker has read them yet. Each
language addresses the learner as DW's Nicos Weg edition in that language does. Below: per language,
the choices a native speaker should confirm first.

Common to all: the macOS menu path in `speech.settings.betterVoices` (written from memory, or left in
English where macOS has no such localisation), the short interval units of the review (`study.unit`;
a unit that is a word starts with a no-break space: "4 روز"), the profile and flag colour names. A
sentence whose words agree with a count is whole in each plural branch (`exams.rating.pending`); the
learning count (`study.count.learning`) is the state word the file uses elsewhere, never a verb.
The phone's tab bar names Review and Settings short where the language's word does not fit a sixth
of 375 px (`nav.short`): de Karten / Optionen, ru Повтор / Опции, uk Повтор / Опції, hu Opciók, pl
Opcje, pt Ajustes, bs Kartice, el Κάρτες, ro Carduri, id Kartu / Setelan — the cards for Review where
no short form of the word reads well.

| Lang | Register | Check first |
|---|---|---|
| ar | masculine singular imperative | رزمة (deck), duals in count-less labels, عَلَقة (leech), units ث/د/س/يوم/شهر/سنة; قيد التجربة (Experimental) apart from تجريبي (mock exam); Latin digits (as `Intl` gives) |
| bs | ti, ijekavian (as DW) | Sveska (Notebook), Pauziraj / Odloži (suspend / bury), cjelina (unit), "Endpoint" in English; "u Postavkama →", "na pitanje je odgovoreno", razmaknica (Space) |
| el | εσύ, monotonic, «;» | μάθημα = course, ενότητα = lesson; "Ξανά ο ήχος" (replay); Διάστημα / πλήκτρο διαστήματος (Space); "στο cloud" kept, as Greek UIs write it; units δευτ./λεπ./ώρ./ημ./μήν./έτ.; language names lower case mid-sentence |
| es | tú, neutral Latin American | computadora vs ordenador (DW mixes both), apartado (item), vuelta (pass), Posponer (bury), "Te damos la bienvenida" |
| fa | تو, Persian digits, ZWNJ | دور (pass) next to دوره (course), نمایه vs پروفایل, تمرین for both exercise and exam practice; در دست آزمایش (Experimental) apart from آزمایشی (mock exam); دسته = deck, گروه = a card's queue; units as short words |
| fr | tu | "Prompt" kept, élément (item), short headers Nouv. / Appr. / Rév., "Cartes révisées" |
| hi | तुम, DW's spelling (no nukta, "." not "।") | अध्याय (unit), दौर (pass), दोहराव (Review), state names from English; units as short words (सेकंड … साल) |
| hu | te | "MI" for AI, kör (pass), részfeladat (item), makacs kártya (leech); the macOS menu path in Hungarian (Rendszerbeállítások → Kisegítő lehetőségek → Felolvasott tartalom → Rendszerhang → Hangok kezelése); an import's counts "# szónak van hangja" |
| id | kamu | Bab (unit), Pengulangan (Review), putaran (pass); -ku as aku elsewhere (Kursusku, Kataku, Ujianku) |
| pl | ty, gendered past forms avoided | fiszka vs karta (card), Rozdział (unit), "Do powt."; ratings Jeszcze raz / Trudno / Dobrze / Łatwo |
| pt | você (Brazilian, as DW's pt edition) | rodada (pass), Adiar (bury); `=0` branches added (CLDR puts 0 in `one`) |
| ro | tu, ș ț with comma below | amână (bury), "l" for months, colour names, "Carduri recapitulate" |
| sw | wewe | seti (deck), igizo (scene), mzunguko (pass), agreement of wasifu; Utangulizi (overview) apart from Muhtasari (summary); units after the number, apart (Swahili would name the unit first) |
| tr | sen | "Mevcut" (Available tab), Uç nokta (endpoint), YZ as the short AI label |
| uk | ти, translated from English | Ендпоінт / Промпт, short headers, "Пристрої, де виконано вхід", Вивчаються (learning) |
| zh | 你, Simplified, no spaces between Chinese and Latin | 学习记录 (Notebook), 辅导老师 (tutor), 轮 (pass), 难记 (leech); 课 / 本课 / 各课 / 前几课 = lesson, 课程 only = course; “” and … in Fira (narrower than a CJK font's) |

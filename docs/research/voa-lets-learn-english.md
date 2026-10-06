# Research — VOA Learning English «Let's Learn English»

Facts observed on `learningenglish.voanews.com` (October 2026); the importer is
`courses/voa-lets-learn-english` (spec 03 §6).

## Site and licence

- Landing pages: `/p/5644.html` (Level 1, groups "Lessons 1 - 10" … "41 - 52"), `/p/6765.html` (Level 2:
  six groups of five lessons plus a review; the last group has none). Lessons are `/a/<slug>/<id>.html`.
- VOA's own material is public domain (third-party photos are not — no images are fetched).
  robots.txt allows `/a/`, `/p/`, `/Quiz/Start?…`; disallows `/*?p=*`, `/embed/*`, `/comments/*`.
- Media hosts: `voa-video-ns.akamaized.net`, `voa-audio.voanews.eu`, `docs.voanews.eu`; URLs carry
  `?cb=`; "Direct link" adds `download=1` (stripped).

## Page structure

- Renditions in `data-sources` JSON, the download menu, or `src`/`data-info`: video 240…1080p, audio 64 and
  128 kbps.
- Article: main video, conversation audio, transcript (`div`/`p` lines, tables) with new words in bold,
  Speaking Practice and Pronunciation videos (Level 1 only; sometimes under another heading), a listening
  quiz, "Review of Lessons", extras (Bloopers, Emergency Language, music), "For Teachers" boilerplate,
  lesson-plan PDFs (Key Words with definitions, speaking scripts, the quiz).
- Quiz: `/Quiz/Start?id=Q&page=N`. Odd pages show question k unanswered; even pages (`2k`) show the result
  view, the correct option with class `quiz__answers-item--correct`; "Question k / N" gives the count.
  470 questions in 87 quizzes, each with one correct answer; 13 point at a photo instead of a clip.

## Counts (import of October 2026)

Level 1: 5 units, 52 lessons, 104 selfrate + 52 quizzes (295 questions), 627 words. Level 2: 6 units,
35 lessons, 35 quizzes (175 questions), 458 words. 846 media files, 9.34 GB.

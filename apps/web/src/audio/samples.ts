// What "Listen" in Settings → Speech reads (08; 09): a few everyday sentences per language — a greeting,
// a statement and a question, so a voice's intonation is heard — our own text, in the language of the
// voice (not the interface's). Covers every language Piper, Qwen3-TTS and the courses' editions speak.
// Pure: tested without a browser.

const SAMPLES: Record<string, readonly string[]> = {
  ar: [
    "صباح الخير! الطقس جميل جدًا اليوم. هل تريد أن نتمشى قليلًا؟",
    "اسمي آنا، وأنا أتعلم لغة جديدة. كل يوم أفهم أكثر قليلًا.",
  ],
  bg: [
    "Добро утро! Днес времето е прекрасно. Ще излезем ли на разходка?",
    "Казвам се Анна и уча нов език. Всеки ден разбирам малко повече.",
  ],
  bs: [
    "Dobro jutro! Danas je divno vrijeme. Hoćemo li u šetnju?",
    "Zovem se Ana i učim novi jezik. Svakog dana razumijem malo više.",
  ],
  ca: [
    "Bon dia! Avui fa un temps magnífic. Vols anar a fer una passejada?",
    "Em dic Anna i estic aprenent una llengua nova. Cada dia entenc una mica més.",
  ],
  cs: [
    "Dobré ráno! Dnes je krásné počasí. Nepůjdeme na procházku?",
    "Jmenuji se Anna a učím se nový jazyk. Každý den rozumím trochu víc.",
  ],
  cy: [
    "Bore da! Mae'r tywydd yn braf heddiw. Wyt ti eisiau mynd am dro?",
    "Anna ydw i, ac rydw i'n dysgu iaith newydd. Bob dydd rydw i'n deall ychydig mwy.",
  ],
  da: [
    "Godmorgen! Vejret er dejligt i dag. Skal vi gå en tur?",
    "Jeg hedder Anna, og jeg lærer et nyt sprog. Hver dag forstår jeg lidt mere.",
  ],
  de: [
    "Guten Morgen! Heute ist das Wetter wunderschön. Hast du Lust auf einen Spaziergang?",
    "Ich heiße Anna und lerne eine neue Sprache. Jeden Tag verstehe ich ein bisschen mehr.",
  ],
  el: [
    "Καλημέρα! Ο καιρός είναι υπέροχος σήμερα. Πάμε μια βόλτα;",
    "Με λένε Άννα και μαθαίνω μια καινούργια γλώσσα. Κάθε μέρα καταλαβαίνω λίγο περισσότερα.",
  ],
  en: [
    "Good morning! The weather is lovely today. Would you like to go for a walk?",
    "My name is Anna, and I'm learning a new language. Every day I understand a little more.",
  ],
  es: [
    "¡Buenos días! Hoy hace un tiempo estupendo. ¿Quieres dar un paseo?",
    "Me llamo Anna y estoy aprendiendo un idioma nuevo. Cada día entiendo un poco más.",
  ],
  eu: [
    "Egun on! Gaur eguraldi ederra dago. Paseo bat emango dugu?",
    "Anna naiz, eta hizkuntza berri bat ikasten ari naiz. Egunero pixka bat gehiago ulertzen dut.",
  ],
  fa: [
    "صبح بخیر! امروز هوا خیلی خوب است. می‌خواهی کمی قدم بزنیم؟",
    "اسم من آناست و دارم یک زبان تازه یاد می‌گیرم. هر روز کمی بیشتر می‌فهمم.",
  ],
  fi: [
    "Hyvää huomenta! Tänään on ihana sää. Lähdetäänkö kävelylle?",
    "Nimeni on Anna, ja opiskelen uutta kieltä. Joka päivä ymmärrän vähän enemmän.",
  ],
  fr: [
    "Bonjour ! Il fait très beau aujourd'hui. Tu veux aller te promener ?",
    "Je m'appelle Anna et j'apprends une nouvelle langue. Chaque jour, je comprends un peu mieux.",
  ],
  he: [
    "בוקר טוב! מזג האוויר נהדר היום. רוצה לצאת לטיול?",
    "קוראים לי אנה, ואני לומדת שפה חדשה. כל יום אני מבינה קצת יותר.",
  ],
  hi: [
    "सुप्रभात! आज मौसम बहुत सुहावना है। क्या हम टहलने चलें?",
    "मेरा नाम अन्ना है और मैं एक नई भाषा सीख रही हूँ। हर दिन मैं थोड़ा और समझती हूँ।",
  ],
  hr: [
    "Dobro jutro! Danas je divno vrijeme. Idemo li u šetnju?",
    "Zovem se Ana i učim novi jezik. Svaki dan razumijem malo više.",
  ],
  hu: [
    "Jó reggelt! Ma gyönyörű idő van. Elmegyünk sétálni?",
    "Anna vagyok, és egy új nyelvet tanulok. Minden nap egy kicsit többet értek.",
  ],
  id: [
    "Selamat pagi! Cuaca hari ini sangat cerah. Mau jalan-jalan?",
    "Nama saya Anna, dan saya sedang belajar bahasa baru. Setiap hari saya mengerti sedikit lebih banyak.",
  ],
  is: [
    "Góðan daginn! Veðrið er yndislegt í dag. Eigum við að fara í göngutúr?",
    "Ég heiti Anna og er að læra nýtt tungumál. Á hverjum degi skil ég aðeins meira.",
  ],
  it: [
    "Buongiorno! Oggi è una bellissima giornata. Ti va di fare una passeggiata?",
    "Mi chiamo Anna e sto imparando una nuova lingua. Ogni giorno capisco un po' di più.",
  ],
  ja: [
    "おはようございます！今日はとてもいい天気ですね。散歩に行きませんか？",
    "私はアンナです。新しい言語を勉強しています。毎日少しずつわかるようになっています。",
  ],
  ka: [
    "დილა მშვიდობისა! დღეს მშვენიერი ამინდია. გავისეირნოთ?",
    "მე მქვია ანა და ახალ ენას ვსწავლობ. ყოველდღე ცოტა მეტს ვიგებ.",
  ],
  kk: [
    "Қайырлы таң! Бүгін ауа райы керемет. Серуендеп қайтайық па?",
    "Менің атым Анна, мен жаңа тіл үйреніп жүрмін. Күн сайын сәл көбірек түсінемін.",
  ],
  ko: [
    "좋은 아침이에요! 오늘 날씨가 정말 좋네요. 같이 산책할까요?",
    "제 이름은 안나예요. 새로운 언어를 배우고 있어요. 매일 조금씩 더 이해하게 돼요.",
  ],
  ku: [
    "Roj baş! Îro hewa pir xweş e. Tu dixwazî em bimeşin?",
    "Navê min Anna ye û ez zimanekî nû hîn dibim. Her roj ez hinekî zêdetir fêm dikim.",
  ],
  lb: [
    "Gudde Moien! Haut ass d'Wieder wonnerschéin. Hues du Loscht op e Spadséiergang?",
    "Ech heeschen Anna an ech léiere eng nei Sprooch. All Dag verstinn ech e bësse méi.",
  ],
  lv: [
    "Labrīt! Šodien ir brīnišķīgs laiks. Vai iesim pastaigāties?",
    "Mani sauc Anna, un es mācos jaunu valodu. Katru dienu es saprotu mazliet vairāk.",
  ],
  ml: [
    "സുപ്രഭാതം! ഇന്ന് നല്ല കാലാവസ്ഥയാണ്. നമുക്ക് നടക്കാൻ പോകാമോ?",
    "എന്റെ പേര് അന്ന എന്നാണ്, ഞാൻ ഒരു പുതിയ ഭാഷ പഠിക്കുകയാണ്. ഓരോ ദിവസവും ഞാൻ കുറച്ചുകൂടി മനസ്സിലാക്കുന്നു.",
  ],
  ne: [
    "शुभ प्रभात! आज मौसम धेरै राम्रो छ। हामी घुम्न जाऔँ?",
    "मेरो नाम अन्ना हो, र म नयाँ भाषा सिक्दैछु। हरेक दिन म अलि बढी बुझ्छु।",
  ],
  nl: [
    "Goedemorgen! Het is prachtig weer vandaag. Zullen we een wandeling maken?",
    "Ik heet Anna en ik leer een nieuwe taal. Elke dag begrijp ik een beetje meer.",
  ],
  no: [
    "God morgen! Været er nydelig i dag. Skal vi gå en tur?",
    "Jeg heter Anna, og jeg lærer et nytt språk. Hver dag forstår jeg litt mer.",
  ],
  pl: [
    "Dzień dobry! Dzisiaj jest piękna pogoda. Może pójdziemy na spacer?",
    "Mam na imię Anna i uczę się nowego języka. Z każdym dniem rozumiem trochę więcej.",
  ],
  pt: [
    "Bom dia! Hoje está um dia lindo. Vamos dar um passeio?",
    "Meu nome é Anna e estou aprendendo uma nova língua. A cada dia entendo um pouco mais.",
  ],
  ro: [
    "Bună dimineața! Astăzi e o vreme minunată. Mergem la o plimbare?",
    "Mă numesc Anna și învăț o limbă nouă. În fiecare zi înțeleg puțin mai mult.",
  ],
  ru: [
    "Доброе утро! Сегодня прекрасная погода. Пойдём гулять?",
    "Меня зовут Анна, и я учу новый язык. С каждым днём я понимаю чуть больше.",
  ],
  sk: [
    "Dobré ráno! Dnes je krásne počasie. Nepôjdeme na prechádzku?",
    "Volám sa Anna a učím sa nový jazyk. Každý deň rozumiem trochu viac.",
  ],
  sl: [
    "Dobro jutro! Danes je čudovito vreme. Greva na sprehod?",
    "Ime mi je Ana in učim se nov jezik. Vsak dan razumem malo več.",
  ],
  sq: [
    "Mirëmëngjes! Sot moti është shumë i bukur. A dalim për një shëtitje?",
    "Unë quhem Ana dhe po mësoj një gjuhë të re. Çdo ditë kuptoj pak më shumë.",
  ],
  sr: [
    "Добро јутро! Данас је дивно време. Хоћемо ли у шетњу?",
    "Зовем се Ана и учим нови језик. Сваког дана разумем мало више.",
  ],
  sv: [
    "God morgon! Vädret är underbart i dag. Ska vi ta en promenad?",
    "Jag heter Anna och lär mig ett nytt språk. Varje dag förstår jag lite mer.",
  ],
  sw: [
    "Habari za asubuhi! Leo hali ya hewa ni nzuri sana. Twende tukatembee?",
    "Jina langu ni Anna, na ninajifunza lugha mpya. Kila siku ninaelewa zaidi kidogo.",
  ],
  th: [
    "สวัสดีตอนเช้า! วันนี้อากาศดีมาก ไปเดินเล่นกันไหม",
    "ฉันชื่อแอนนา และกำลังเรียนภาษาใหม่ ทุกวันฉันเข้าใจมากขึ้นอีกนิด",
  ],
  tr: [
    "Günaydın! Bugün hava çok güzel. Yürüyüşe çıkalım mı?",
    "Benim adım Anna ve yeni bir dil öğreniyorum. Her gün biraz daha fazla anlıyorum.",
  ],
  uk: [
    "Доброго ранку! Сьогодні чудова погода. Підемо на прогулянку?",
    "Мене звати Анна, і я вчу нову мову. З кожним днем я розумію трохи більше.",
  ],
  ur: [
    "صبح بخیر! آج موسم بہت اچھا ہے۔ کیا ہم سیر کے لیے چلیں؟",
    "میرا نام آنا ہے اور میں ایک نئی زبان سیکھ رہی ہوں۔ ہر دن میں تھوڑا زیادہ سمجھتی ہوں۔",
  ],
  vi: [
    "Chào buổi sáng! Hôm nay trời đẹp quá. Mình đi dạo nhé?",
    "Tôi tên là Anna, và tôi đang học một ngôn ngữ mới. Mỗi ngày tôi hiểu thêm một chút.",
  ],
  zh: [
    "早上好！今天天气真好。我们去散散步吧？",
    "我叫安娜，正在学习一门新语言。我每天都能多懂一点。",
  ],
};

/** Codes that name a language the table keeps under another code. */
const SAME: Record<string, string> = { nb: "no", nn: "no" };

/** The sentences "Listen" reads in a language ("de", "de-DE", "de_DE"): none when it has none. */
export function samplesOf(lang: string): readonly string[] {
  const base = lang.split(/[-_]/)[0]?.toLowerCase() ?? "";
  return SAMPLES[SAME[base] ?? base] ?? [];
}

/** Every language with sentences (for tests). */
export const SAMPLE_LANGUAGES = Object.keys(SAMPLES);

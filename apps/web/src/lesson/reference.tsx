// Lesson reference: vocabulary, grammar, culture, script, PDFs (lesson tabs, 09).
import type { Lesson, LocaleLesson } from "@sprachanker/schema";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs.tsx";
import { CourseSections } from "@/ui/course-html.tsx";
import { AudioButton } from "@/ui/media.tsx";
import { useTargetLang } from "@/ui/target-lang.ts";
import { GenderWord } from "@/word/word.tsx";

/** A grammar or culture page's title; a topic begun in an earlier lesson says which part this is. */
/** A page's title as shown, with its part; "" for a page the source gave no title. */
export const pageTitle = (
  page: { title?: string; part?: number },
  t: (key: string, values?: Record<string, unknown>) => string,
) => {
  if (!page.title) return "";
  return page.part ? `${page.title} · ${t("lesson.part", { n: page.part })}` : page.title;
};

function VocabularyList({
  lesson,
  locale,
  url,
}: {
  lesson: Lesson;
  locale: LocaleLesson | null;
  url(p: string): string;
}) {
  const { t } = useTranslation();
  const lang = useTargetLang();
  return (
    <ul className="divide-y">
      {lesson.vocab.map((v) => (
        <li key={v.key} className="flex items-center gap-3 py-2.5">
          {v.audio ? (
            <AudioButton src={url(v.audio)} label={v.target} className="size-10" />
          ) : (
            <span className="size-10 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <GenderWord text={v.target} gender={v.gender} className="text-lg" />
            {v.ipa && <span className="ml-2 text-sm text-muted-foreground">{v.ipa}</span>}
            {(v.forms || v.note) && (
              <div className="text-sm text-muted-foreground">
                {[v.forms, v.note].filter(Boolean).join(" · ")}
              </div>
            )}
            {v.examples?.map((example, i) => (
              <div key={example} className="text-sm">
                <span lang={lang} className="italic">
                  {example}
                </span>
                {locale?.vocab[v.key]?.examples?.[i] && (
                  <span className="text-muted-foreground">
                    {" "}
                    — {locale.vocab[v.key]?.examples?.[i]}
                  </span>
                )}
              </div>
            ))}
            {!v.gender && v.plural && (
              <div className="text-sm text-muted-foreground">
                {t("word.plural", { plural: v.plural })}
              </div>
            )}
          </div>
          <div className="max-w-[45%] text-right text-[15px]">
            {locale?.vocab[v.key]?.translation}
          </div>
          {v.image && (
            <img src={url(v.image)} alt="" className="hidden h-12 w-auto rounded-md sm:block" />
          )}
        </li>
      ))}
    </ul>
  );
}

function Pages({ pages }: { pages: Array<{ title?: string; bodyHtml: string; part?: number }> }) {
  const { t } = useTranslation();
  if (!pages.length) return <p className="text-muted-foreground">{t("ref.none")}</p>;
  return (
    <div className="space-y-6">
      {pages.map((p) => (
        <article key={`${p.title ?? ""}:${p.bodyHtml.length}`}>
          {p.title && <h3 className="mb-2 text-xl font-bold">{pageTitle(p, t)}</h3>}
          <CourseSections html={p.bodyHtml} />
        </article>
      ))}
    </div>
  );
}

export type ReferenceTab =
  | "vocabulary"
  | "grammar"
  | "culture"
  | "script"
  | "homework"
  | "downloads";

/** The reference tabs that have something in this lesson, in display order. */
export function referenceTabs(lesson: Lesson, locale: LocaleLesson | null): ReferenceTab[] {
  const has: Record<ReferenceTab, boolean> = {
    vocabulary: lesson.vocab.length > 0,
    grammar: !!locale?.tabs.grammar.length,
    culture: !!locale?.tabs.culture.length,
    script: !!locale?.tabs.script,
    homework: !!locale?.tabs.homework?.length,
    downloads: !!locale?.downloads.length,
  };
  return (Object.keys(has) as ReferenceTab[]).filter((tab) => has[tab]);
}

export function Reference({
  lesson,
  locale,
  url,
  tab,
  onTab,
}: {
  lesson: Lesson;
  locale: LocaleLesson | null;
  url(p: string): string;
  tab: ReferenceTab;
  onTab(tab: ReferenceTab): void;
}) {
  const { t } = useTranslation();
  const tabs = locale?.tabs ?? { grammar: [], culture: [] };
  return (
    <Tabs value={tab} onValueChange={(v) => onTab(v as ReferenceTab)}>
      {/* The tabs wrap rather than run out of the panel (a lesson may have five). */}
      <TabsList className="h-auto! w-full flex-wrap justify-start">
        {referenceTabs(lesson, locale).map((k) => (
          <TabsTrigger key={k} value={k} className="min-h-8 pointer-coarse:min-h-10">
            {t(`ref.${k}`)}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="mt-4">
        <TabsContent value="vocabulary">
          <VocabularyList lesson={lesson} locale={locale} url={url} />
        </TabsContent>
        <TabsContent value="grammar">
          <Pages pages={tabs.grammar} />
        </TabsContent>
        <TabsContent value="culture">
          <Pages pages={tabs.culture} />
        </TabsContent>
        <TabsContent value="script">
          <Pages pages={tabs.script ? [tabs.script] : []} />
        </TabsContent>
        <TabsContent value="homework">
          <Pages pages={tabs.homework ?? []} />
        </TabsContent>
        <TabsContent value="downloads">
          {locale?.downloads.length ? (
            <ul className="space-y-2">
              {locale.downloads.map((d) => (
                <li key={d.path}>
                  <a
                    href={url(d.path)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 underline-offset-4 hover:underline pointer-coarse:min-h-11"
                  >
                    <FileText className="size-4" /> {d.title}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">{t("ref.none")}</p>
          )}
        </TabsContent>
      </div>
    </Tabs>
  );
}

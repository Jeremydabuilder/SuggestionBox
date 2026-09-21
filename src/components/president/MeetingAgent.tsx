"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { prepareWeeklyMeeting } from "@/app/president/actions";
import type { MeetingBrief, MeetingScope } from "@/lib/meeting-agent";

const SCOPE_OPTIONS: Array<{ value: MeetingScope; label: string }> = [
  { value: "new", label: "Past 7 days" },
  { value: "active", label: "Active backlog" },
  { value: "all", label: "All history" },
];

export default function MeetingAgent({ configured }: { configured: boolean }) {
  const [scope, setScope] = useState<MeetingScope>("new");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<MeetingBrief | null>(null);
  const [copied, setCopied] = useState(false);

  const sourceTitles = useMemo(
    () => new Map(brief?.sources.map((source) => [source.ref, source.title]) ?? []),
    [brief],
  );

  async function generate() {
    setLoading(true);
    setError(null);
    const result = await prepareWeeklyMeeting(scope);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setBrief(result.data);
  }

  async function copyBrief() {
    if (!brief) return;
    const lines = [
      `# ${brief.headline}`,
      "",
      brief.executiveSummary,
      "",
      "## Agenda",
      ...brief.agenda.flatMap((item, index) => [
        `${index + 1}. ${item.title} (${item.minutes} min)`,
        `   ${item.whyNow}`,
        ...item.talkingPoints.map((point) => `   - ${point}`),
      ]),
      "",
      "## Decisions needed",
      ...brief.decisionsNeeded.map((item) => `- ${item.question} — ${item.context}`),
      "",
      "## Follow-ups",
      ...brief.followUps.map(
        (item) => `- ${item.action} (${item.suggestedOwner}; ${item.timing})`,
      ),
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section className="mt-4 overflow-hidden rounded-[16px] border border-violet-300/55 bg-[linear-gradient(135deg,rgba(91,68,181,0.11),rgba(226,78,27,0.07)_55%,rgba(255,255,255,0.75))] shadow-[0_12px_35px_-28px_rgba(55,39,120,0.75)]">
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <div
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-violet-700 text-xl text-white shadow-sm"
            aria-hidden
          >
            ✦
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="eyebrow text-violet-800">Weekly meeting agent</p>
              <span className="rounded-full border border-violet-300 bg-violet-100/70 px-2 py-0.5 text-[10px] font-bold tracking-wide text-violet-900 uppercase">
                Presidents only
              </span>
            </div>
            <h2 className="mt-1 text-lg font-bold text-navy">
              Turn the inbox into a 30-minute plan
            </h2>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-navy-soft">
              Groups repeated ideas, finds quick wins, and prepares decisions and follow-ups.
              Names and emails are never sent to the AI.
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          <label>
            <span className="sr-only">Suggestions to include</span>
            <select
              className="field min-w-40 py-[0.62rem] text-[13px]"
              value={scope}
              onChange={(event) => setScope(event.target.value as MeetingScope)}
              disabled={loading}
            >
              {SCOPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-primary min-w-44"
            onClick={generate}
            disabled={loading || !configured}
          >
            {loading ? "Organizing ideas…" : brief ? "Regenerate brief" : "Prepare meeting"}
          </button>
        </div>
      </div>

      {!configured && (
        <div className="border-t border-violet-200/70 bg-white/45 px-4 py-3 text-[12.5px] text-navy-soft sm:px-5">
          Setup is complete. Add <code className="rounded bg-navy/7 px-1.5 py-0.5 font-mono text-navy">GROQ_API_KEY</code> in Render → Environment, then redeploy. Do not paste the key into chat or GitHub.
        </div>
      )}
      {error && (
        <p role="alert" className="border-t border-rose-200 bg-rose-50/80 px-4 py-3 text-sm font-medium text-rose-800 sm:px-5">
          {error}
        </p>
      )}

      <AnimatePresence initial={false}>
        {brief && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-violet-200/70 bg-paper/80"
          >
            <div className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">Prepared brief</p>
                  <h3 className="mt-1 text-xl font-bold text-navy">{brief.headline}</h3>
                  <p className="mt-2 max-w-4xl text-sm leading-relaxed text-navy-soft">
                    {brief.executiveSummary}
                  </p>
                </div>
                <button type="button" onClick={copyBrief} className="btn-quiet">
                  {copied ? "Copied" : "Copy agenda"}
                </button>
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-[1.35fr_0.85fr]">
                <div>
                  <p className="eyebrow">30-minute agenda</p>
                  <ol className="mt-2 space-y-2.5">
                    {brief.agenda.map((item, index) => (
                      <li key={`${item.title}-${index}`} className="rounded-xl border border-rule bg-paper px-3.5 py-3">
                        <div className="flex items-start gap-3">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-navy text-xs font-bold text-white">
                            {index + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h4 className="font-bold text-navy">{item.title}</h4>
                              <span className="rounded-full bg-paper-deep px-2 py-0.5 text-[11px] font-semibold text-navy-soft">
                                {item.minutes} min
                              </span>
                            </div>
                            <p className="mt-1 text-[12.5px] leading-relaxed text-navy-soft">{item.whyNow}</p>
                            <ul className="mt-2 space-y-1 text-[12.5px] text-navy">
                              {item.talkingPoints.map((point) => <li key={point}>• {point}</li>)}
                            </ul>
                            <References refs={item.suggestionRefs} titles={sourceTitles} />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="space-y-4">
                  <BriefList
                    title="Quick wins"
                    empty="No obvious quick wins this time."
                    items={brief.quickWins.map((item) => ({ title: item.title, body: item.nextStep, refs: item.suggestionRefs }))}
                    titles={sourceTitles}
                  />
                  <BriefList
                    title="Decisions needed"
                    empty="No major decisions flagged."
                    items={brief.decisionsNeeded.map((item) => ({ title: item.question, body: item.context, refs: item.suggestionRefs }))}
                    titles={sourceTitles}
                  />
                  <BriefList
                    title="Follow-ups"
                    empty="No follow-ups proposed."
                    items={brief.followUps.map((item) => ({ title: item.action, body: `${item.suggestedOwner} · ${item.timing}`, refs: item.suggestionRefs }))}
                    titles={sourceTitles}
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-3 text-[11px] text-navy-soft">
                <span>{brief.sourceCount} anonymized suggestion{brief.sourceCount === 1 ? "" : "s"} reviewed · AI suggestions require your judgment</span>
                <span>Generated {new Date(brief.generatedAt).toLocaleString()}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function BriefList({
  title,
  items,
  empty,
  titles,
}: {
  title: string;
  items: Array<{ title: string; body: string; refs: string[] }>;
  empty: string;
  titles: Map<string, string>;
}) {
  return (
    <section>
      <p className="eyebrow">{title}</p>
      <div className="mt-2 space-y-2">
        {items.length === 0 ? (
          <p className="rounded-xl border border-rule bg-paper px-3 py-2.5 text-[12.5px] text-navy-soft">{empty}</p>
        ) : items.map((item, index) => (
          <div key={`${item.title}-${index}`} className="rounded-xl border border-rule bg-paper px-3 py-2.5">
            <h4 className="text-[13px] font-bold text-navy">{item.title}</h4>
            <p className="mt-1 text-[12px] leading-relaxed text-navy-soft">{item.body}</p>
            <References refs={item.refs} titles={titles} />
          </div>
        ))}
      </div>
    </section>
  );
}

function References({ refs, titles }: { refs: string[]; titles: Map<string, string> }) {
  if (refs.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {refs.map((ref) => (
        <span key={ref} title={titles.get(ref)} className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-900">
          {ref}
        </span>
      ))}
    </div>
  );
}


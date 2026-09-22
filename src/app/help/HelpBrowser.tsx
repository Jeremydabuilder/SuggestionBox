"use client";

import { useMemo, useState } from "react";
import type { HelpTopic } from "@/lib/help-content";

/**
 * Searchable, collapsible list of help topics — shared by the public
 * student /help page and the protected co-president help panel, so both
 * render from the exact same data (help-content.ts) with the exact same
 * component. Printing expands everything via CSS (see index.css's print
 * rules aren't needed here — details/summary prints open natively in
 * every major browser once :open, handled below with the open attribute).
 */
export default function HelpBrowser({ topics }: { topics: HelpTopic[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return topics;
    return topics.filter((t) => t.question.toLowerCase().includes(needle) || t.answer.some((p) => p.toLowerCase().includes(needle)));
  }, [topics, query]);

  return (
    <div className="mt-8">
      <label className="sr-only" htmlFor="help-search">
        Search help topics
      </label>
      <input
        id="help-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search help topics…"
        className="w-full rounded-[10px] border border-rule bg-white px-4 py-2.5 text-[14.5px] shadow-sm print:hidden"
      />

      <div className="mt-5 space-y-2.5">
        {filtered.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-rule px-4 py-8 text-center text-sm text-navy-soft">
            No help topics match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          filtered.map((topic) => (
            <details key={topic.id} className="group rounded-[10px] border border-rule bg-white/70 open:bg-white print:open print:border-0 print:bg-transparent">
              <summary className="cursor-pointer list-none px-4 py-3.5 text-[14.5px] font-semibold text-navy marker:content-none print:cursor-default">
                <span className="mr-2 inline-block text-navy-soft transition-transform group-open:rotate-90 print:hidden">›</span>
                {topic.question}
              </summary>
              <div className="space-y-2 px-4 pb-4 text-[13.5px] leading-relaxed text-navy-soft">
                {topic.answer.map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </div>
            </details>
          ))
        )}
      </div>
    </div>
  );
}

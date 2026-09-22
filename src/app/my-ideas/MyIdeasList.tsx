"use client";

import { useEffect, useState } from "react";
import { CATEGORY_LABELS, STATUS_LABELS, STATUS_STYLES, type ConversationSummary, type Suggestion } from "@/lib/types";
import { getMyConversationSummaries } from "./conversation-actions";
import StudentConversation from "./StudentConversation";

export default function MyIdeasList({ suggestions }: { suggestions: Suggestion[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, ConversationSummary>>({});

  useEffect(() => {
    void getMyConversationSummaries().then((result) => {
      if (result.ok) setSummaries(result.data);
    });
  }, []);

  return (
    <div className="mt-8 space-y-3">
      {suggestions.map((suggestion) => {
        const summary = summaries[suggestion.id];
        const isOpen = openId === suggestion.id;
        return (
          <article key={suggestion.id} className="paper p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold text-navy-soft">{CATEGORY_LABELS[suggestion.category]}</p>
                <h2 className="mt-1 text-lg font-bold text-navy">{suggestion.title}</h2>
              </div>
              <span className={`inline-flex rounded-full border px-2.5 py-1 text-[12px] font-semibold ${STATUS_STYLES[suggestion.status]}`}>
                {STATUS_LABELS[suggestion.status]}
              </span>
            </div>
            <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-navy-soft">{suggestion.description}</p>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-rule pt-3 text-[12px] text-navy-soft">
              <span>Sent {new Date(suggestion.created_at).toLocaleDateString()}</span>
              <span>{suggestion.is_read ? "Viewed by a co-president" : "Not viewed yet"}</span>
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : suggestion.id)}
                className="btn-quiet relative ml-auto py-1 text-[12px]"
              >
                {isOpen ? "Hide conversation" : "Conversation"}
                {summary?.unread && !isOpen && (
                  <span aria-label="Unread reply" className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />
                )}
              </button>
            </div>
            {isOpen && <StudentConversation suggestionId={suggestion.id} />}
          </article>
        );
      })}
    </div>
  );
}

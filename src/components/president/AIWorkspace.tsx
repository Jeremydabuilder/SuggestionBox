"use client";

import { useState } from "react";
import MeetingAgent from "./MeetingAgent";
import MeetingHistory from "./MeetingHistory";
import DecisionLog, { type PrefillDecision } from "./DecisionLog";
import ActionItems, { type PrefillAction } from "./ActionItems";
import type { Suggestion } from "@/lib/types";

type WorkspaceTab = "prep" | "history" | "decisions" | "actions";

const TABS: Array<{ value: WorkspaceTab; label: string }> = [
  { value: "prep", label: "Meeting Prep" },
  { value: "history", label: "Meeting History" },
  { value: "decisions", label: "Decisions" },
  { value: "actions", label: "Action Items" },
];

/**
 * The president-only AI Workspace: Meeting Prep, Meeting History, Decisions
 * and Action Items today, with room for the rest of the spec (Since Last
 * Meeting, Ask the Inbox, Draft Updates) as later tabs. Deliberately styled
 * as more dashboard tabs, not a separate product — no gradients or card
 * nesting beyond what the rest of the panel already uses.
 */
export default function AIWorkspace({
  configured,
  suggestions,
  onOpenSuggestion,
}: {
  configured: boolean;
  suggestions: Suggestion[];
  onOpenSuggestion: (id: string) => void;
}) {
  const [tab, setTab] = useState<WorkspaceTab>("prep");
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [decisionPrefill, setDecisionPrefill] = useState<PrefillDecision | null>(null);
  const [actionPrefill, setActionPrefill] = useState<PrefillAction | null>(null);

  function addToDecisionLog(prefill: PrefillDecision) {
    setDecisionPrefill(prefill);
    setTab("decisions");
  }
  function addToActionItems(prefill: PrefillAction) {
    setActionPrefill(prefill);
    setTab("actions");
  }

  return (
    <section className="mt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow text-violet-800">AI Workspace</p>
          <h2 className="mt-1 text-xl font-bold text-navy">Presidents-only tools</h2>
        </div>
        <div className="flex flex-wrap gap-1.5 rounded-[10px] border border-rule bg-paper-deep/60 p-1">
          {TABS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setTab(option.value)}
              aria-current={tab === option.value ? "page" : undefined}
              className={`rounded-[7px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
                tab === option.value ? "bg-white text-navy shadow-sm" : "text-navy-soft hover:text-navy"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "prep" && (
        <MeetingAgent
          configured={configured}
          onSaved={() => setHistoryRefresh((n) => n + 1)}
          onViewHistory={() => setTab("history")}
          onAddDecision={addToDecisionLog}
          onAddAction={addToActionItems}
        />
      )}
      {tab === "history" && (
        <MeetingHistory
          refreshSignal={historyRefresh}
          onAddDecision={addToDecisionLog}
          onAddAction={addToActionItems}
        />
      )}
      {tab === "decisions" && (
        <DecisionLog
          suggestions={suggestions}
          onOpenSuggestion={onOpenSuggestion}
          prefill={decisionPrefill}
          onPrefillConsumed={() => setDecisionPrefill(null)}
        />
      )}
      {tab === "actions" && (
        <ActionItems
          suggestions={suggestions}
          onOpenSuggestion={onOpenSuggestion}
          prefill={actionPrefill}
          onPrefillConsumed={() => setActionPrefill(null)}
        />
      )}
    </section>
  );
}

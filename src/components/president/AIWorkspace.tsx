"use client";

import { useState } from "react";
import MeetingAgent from "./MeetingAgent";
import MeetingHistory from "./MeetingHistory";

type WorkspaceTab = "prep" | "history";

/**
 * The president-only AI Workspace: Meeting Prep and Meeting History today,
 * with room for the rest of the spec (Since Last Meeting, Ask the Inbox,
 * Decisions, Action List, Draft Updates) as later tabs. Deliberately styled
 * as more dashboard tabs, not a separate product — no gradients or card
 * nesting beyond what the rest of the panel already uses.
 */
export default function AIWorkspace({ configured }: { configured: boolean }) {
  const [tab, setTab] = useState<WorkspaceTab>("prep");
  const [historyRefresh, setHistoryRefresh] = useState(0);

  return (
    <section className="mt-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow text-violet-800">AI Workspace</p>
          <h2 className="mt-1 text-xl font-bold text-navy">Presidents-only tools</h2>
        </div>
        <div className="flex gap-1.5 rounded-[10px] border border-rule bg-paper-deep/60 p-1">
          <button
            type="button"
            onClick={() => setTab("prep")}
            aria-current={tab === "prep" ? "page" : undefined}
            className={`rounded-[7px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
              tab === "prep" ? "bg-white text-navy shadow-sm" : "text-navy-soft hover:text-navy"
            }`}
          >
            Meeting Prep
          </button>
          <button
            type="button"
            onClick={() => setTab("history")}
            aria-current={tab === "history" ? "page" : undefined}
            className={`rounded-[7px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${
              tab === "history" ? "bg-white text-navy shadow-sm" : "text-navy-soft hover:text-navy"
            }`}
          >
            Meeting History
          </button>
        </div>
      </div>

      {tab === "prep" ? (
        <MeetingAgent
          configured={configured}
          onSaved={() => setHistoryRefresh((n) => n + 1)}
          onViewHistory={() => setTab("history")}
        />
      ) : (
        <MeetingHistory refreshSignal={historyRefresh} />
      )}
    </section>
  );
}

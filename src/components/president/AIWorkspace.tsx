"use client";

import AIChat from "./AIChat";
import type { Suggestion } from "@/lib/types";

/**
 * The president-only AI Workspace. As of Stage 4 this renders the unified
 * AI Co-President chat (AIChat) instead of the old Meeting Prep / Meeting
 * History / Decisions / Action Items tab bar. Those components and their
 * server actions are untouched on disk — Stage 5 connects their tools into
 * the chat itself rather than restoring separate tab navigation.
 *
 * `configured`, `suggestions`, and `onOpenSuggestion` are kept in the
 * signature (unused for now) so PresidentPanel.tsx needs no changes; they
 * will be threaded into chat tool results starting in Stage 5.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature kept for PresidentPanel.tsx; Stage 5 wires these into chat tool results
export default function AIWorkspace(_props: {
  configured: boolean;
  suggestions: Suggestion[];
  onOpenSuggestion: (id: string) => void;
}) {
  return (
    <section className="mt-5">
      <div className="mb-3">
        <p className="eyebrow text-violet-800">AI Workspace</p>
        <h2 className="mt-1 text-xl font-bold text-navy">AI Co-President</h2>
      </div>
      <AIChat />
    </section>
  );
}

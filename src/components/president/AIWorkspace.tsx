"use client";

import AIChat from "./AIChat";
import type { Suggestion } from "@/lib/types";

/**
 * The president-only AI Workspace. As of Stage 4 this renders the unified
 * AI Co-President chat (AIChat) instead of the old Meeting Prep / Meeting
 * History / Decisions / Action Items tab bar. As of Stage 5, those tools
 * are reachable again — from inside the chat, as modal panels — which is
 * why `configured`, `suggestions`, and `onOpenSuggestion` are threaded
 * straight through to AIChat instead of being unused.
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
  return (
    <section className="mt-5">
      <div className="mb-3">
        <p className="eyebrow text-violet-800">AI Workspace</p>
        <h2 className="mt-1 text-xl font-bold text-navy">AI Co-President</h2>
      </div>
      <AIChat configured={configured} suggestions={suggestions} onOpenSuggestion={onOpenSuggestion} />
    </section>
  );
}

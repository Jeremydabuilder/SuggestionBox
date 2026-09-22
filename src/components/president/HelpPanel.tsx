"use client";

import HelpBrowser from "@/app/help/HelpBrowser";
import { PRESIDENT_HELP_TOPICS } from "@/lib/help-content";

/**
 * The co-president guide — reads from the exact same help-content.ts data
 * the public student /help page and the agent's deterministic help
 * answers use, via the same HelpBrowser component, so all three can never
 * say something different about the same feature.
 */
export default function HelpPanel() {
  return (
    <div className="paper p-5 sm:p-6">
      <h2 className="text-lg font-bold text-navy">Help &amp; guide</h2>
      <p className="mt-1 text-[12.5px] text-navy-soft">
        Everything below describes exactly what this dashboard does today. Ask the agent the same questions any time — it
        answers from this same list, with no AI call involved.
      </p>
      <HelpBrowser topics={PRESIDENT_HELP_TOPICS} />
    </div>
  );
}

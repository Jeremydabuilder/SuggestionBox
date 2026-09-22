import type { PlannableIntent } from "./agent-plan.ts";

/**
 * The one suggested-next-action line under an agent turn's combined
 * result. Computed deterministically from real facts the orchestrator
 * already gathered — never model-authored, never a guess — matching the
 * "proactive but not autonomous" requirement: this only ever SUGGESTS
 * (a plain string the president reads), it never performs anything.
 */

export interface AgentTurnFacts {
  plannedIntents: PlannableIntent[];
  hasRisingTrend: boolean;
  promiseGapCount: number;
  overdueActionCount: number;
}

export function deriveSuggestedNextAction(facts: AgentTurnFacts): string | null {
  if (facts.plannedIntents.includes("meeting_prep")) {
    return "Open Meeting Prep to review and save this as a draft agenda.";
  }
  if (facts.promiseGapCount > 0) {
    return "Review the decisions that still have no recorded follow-up action.";
  }
  if (facts.overdueActionCount > 0) {
    return "Check the overdue action items.";
  }
  if (facts.hasRisingTrend) {
    return "Want a proposal drafted from the rising suggestions?";
  }
  return null;
}

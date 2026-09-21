export const CATEGORIES = [
  { value: "events", label: "Events" },
  { value: "food", label: "Food" },
  { value: "school_spaces", label: "School Spaces" },
  { value: "clubs_and_activities", label: "Clubs and Activities" },
  { value: "community", label: "Community" },
  { value: "other", label: "Other" },
] as const;

export type Category = (typeof CATEGORIES)[number]["value"];

export const CATEGORY_VALUES = CATEGORIES.map((c) => c.value) as [Category, ...Category[]];

export const CATEGORY_LABELS: Record<Category, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.label]),
) as Record<Category, string>;

export const STATUSES = [
  { value: "new", label: "New" },
  { value: "reviewing", label: "Reviewing" },
  { value: "discussing", label: "Discussing" },
  { value: "approved", label: "Approved" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "declined", label: "Declined" },
  { value: "archived", label: "Archived" },
] as const;

export type Status = (typeof STATUSES)[number]["value"];

export const STATUS_VALUES = STATUSES.map((s) => s.value) as [Status, ...Status[]];

export const STATUS_LABELS: Record<Status, string> = Object.fromEntries(
  STATUSES.map((s) => [s.value, s.label]),
) as Record<Status, string>;

/** Tailwind classes per status chip. Kept in one place so the panel stays consistent. */
export const STATUS_STYLES: Record<Status, string> = {
  new: "bg-accent/12 text-accent-ink border-accent/30",
  reviewing: "bg-sky-100 text-sky-900 border-sky-300",
  discussing: "bg-violet-100 text-violet-900 border-violet-300",
  approved: "bg-emerald-100 text-emerald-900 border-emerald-300",
  in_progress: "bg-amber-100 text-amber-900 border-amber-300",
  completed: "bg-teal-100 text-teal-900 border-teal-300",
  declined: "bg-rose-100 text-rose-900 border-rose-300",
  archived: "bg-navy/8 text-navy/70 border-navy/20",
};

export const MATCH_STATES = ["suggested", "confirmed", "dismissed"] as const;
export type MatchState = (typeof MATCH_STATES)[number];

export interface SimilarityParts {
  score: number;
  title: number;
  body: number;
  keyword: number;
  sameCategory: boolean;
  sharedKeywords: string[];
}

/**
 * A possible or confirmed relationship between two suggestions. Advisory
 * only: it never changes either suggestion.
 */
export interface SuggestionMatch {
  id: string;
  /** Always the lower of the two ids — see canonicalPair(). */
  suggestion_id: string;
  match_id: string;
  score: number;
  breakdown: SimilarityParts | Record<string, never>;
  method: string;
  state: MatchState;
  /** The president who last confirmed or dismissed this pair. */
  decided_by: string | null;
  decided_at: string | null;
  /** Set when a president has undone a dismissal. */
  reopened_by: string | null;
  reopened_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Suggestion {
  id: string;
  title: string;
  description: string;
  category: Category;
  improvement_reason: string;
  student_name: string | null;
  student_email: string | null;
  is_anonymous: boolean;
  status: Status;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * The suggestion this one is filed under, when presidents have decided
   * several submissions are the same idea. Null means it is not a duplicate
   * of anything, or is itself the one being tracked.
   */
  primary_suggestion_id: string | null;
  /** Present only for a signed-in, non-anonymous student submission. */
  submitter_user_id?: string | null;
}

export interface InternalNote {
  id: string;
  suggestion_id: string;
  author_email: string;
  body: string;
  created_at: string;
}

export interface StatusHistoryEntry {
  id: string;
  suggestion_id: string;
  from_status: Status | null;
  to_status: Status;
  changed_by: string | null;
  created_at: string;
}

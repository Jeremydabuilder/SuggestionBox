"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import SuggestionDetail from "./SuggestionDetail";
import { ArchiveIcon, LocalTime, RelativeTime, SearchIcon, StatusChip } from "./ui";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { signOut } from "@/app/president/actions";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  STATUSES,
  type Category,
  type Status,
  type Suggestion,
  type SuggestionMatch,
} from "@/lib/types";
import { matchCountFor, relatedGroupSize } from "@/lib/duplicates";
import { rescanDuplicates } from "@/app/president/actions";

type SortOrder = "newest" | "oldest";
type ReadFilter = "all" | "unread" | "read";

const POLL_INTERVAL_MS = 45_000;

export default function PresidentPanel({
  suggestions,
  matches,
  currentEmail,
}: {
  suggestions: Suggestion[];
  matches: SuggestionMatch[];
  currentEmail: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");
  const [status, setStatus] = useState<Status | "all">("all");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [sort, setSort] = useState<SortOrder>("newest");
  const [showArchived, setShowArchived] = useState(false);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [rescanNote, setRescanNote] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [arrivedCount, setArrivedCount] = useState(0);
  const [detailSignal, setDetailSignal] = useState(0);
  const [live, setLive] = useState(false);

  const knownIds = useRef<Set<string>>(new Set(suggestions.map((s) => s.id)));

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);

  /* ---- live updates: both co-presidents stay in sync ---------------- */
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel("president-panel")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "suggestions" },
        (payload: RealtimePostgresChangesPayload<Suggestion>) => {
          const id = (payload.new as { id?: string })?.id;
          if (id && !knownIds.current.has(id)) setArrivedCount((n) => n + 1);
          refresh();
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "suggestions" },
        () => refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "internal_notes" },
        () => setDetailSignal((n) => n + 1),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "status_history" },
        () => setDetailSignal((n) => n + 1),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "suggestion_matches" },
        () => {
          setDetailSignal((n) => n + 1);
          refresh();
        },
      )
      .subscribe((state: string) => setLive(state === "SUBSCRIBED"));

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  /* ---- polling fallback, in case realtime is unavailable ------------ */
  useEffect(() => {
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  /* ---- notice when suggestions arrive while the tab is open --------- */
  useEffect(() => {
    let fresh = 0;
    for (const suggestion of suggestions) {
      if (!knownIds.current.has(suggestion.id)) {
        knownIds.current.add(suggestion.id);
        fresh += 1;
      }
    }
    if (fresh > 0) setArrivedCount((n) => Math.max(n, fresh));
  }, [suggestions]);

  /* ---- duplicate counts, by suggestion -------------------------------- */
  const duplicateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const suggestion of suggestions) {
      const count = matchCountFor(suggestion.id, matches);
      if (count > 0) counts.set(suggestion.id, count);
    }
    return counts;
  }, [suggestions, matches]);

  /* ---- counters ------------------------------------------------------ */
  const stats = useMemo(() => {
    let unread = 0;
    let discussing = 0;
    let completed = 0;
    let archived = 0;
    for (const s of suggestions) {
      if (s.status === "archived") archived += 1;
      else if (!s.is_read) unread += 1;
      if (s.status === "discussing") discussing += 1;
      if (s.status === "completed") completed += 1;
    }
    return {
      total: suggestions.length,
      unread,
      discussing,
      completed,
      archived,
      withDuplicates: duplicateCounts.size,
    };
  }, [suggestions, duplicateCounts]);

  /* ---- filtering, search and sorting -------------------------------- */
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = suggestions.filter((s) => {
      if (status === "all") {
        if (!showArchived && s.status === "archived") return false;
      } else if (s.status !== status) {
        return false;
      }
      if (category !== "all" && s.category !== category) return false;
      if (readFilter === "unread" && s.is_read) return false;
      if (readFilter === "read" && !s.is_read) return false;
      if (duplicatesOnly && !duplicateCounts.has(s.id)) return false;
      if (needle) {
        const haystack = [
          s.title,
          s.description,
          s.improvement_reason,
          s.student_name ?? "",
          s.student_email ?? "",
          CATEGORY_LABELS[s.category],
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      const diff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return sort === "newest" ? -diff : diff;
    });
  }, [suggestions, query, category, status, readFilter, sort, showArchived, duplicatesOnly, duplicateCounts]);

  const selected = useMemo(
    () => suggestions.find((s) => s.id === selectedId) ?? null,
    [suggestions, selectedId],
  );

  useEffect(() => {
    // A suggestion that disappeared (e.g. filtered away by the other
    // president archiving it) should not leave a stale detail pane open.
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  const filtersActive =
    query.trim().length > 0 ||
    category !== "all" ||
    status !== "all" ||
    readFilter !== "all" ||
    showArchived ||
    duplicatesOnly;

  function clearFilters() {
    setQuery("");
    setCategory("all");
    setStatus("all");
    setReadFilter("all");
    setShowArchived(false);
    setDuplicatesOnly(false);
  }

  async function runRescan() {
    setRescanning(true);
    setRescanNote(null);
    const result = await rescanDuplicates();
    setRescanning(false);
    setRescanNote(
      result.ok
        ? result.data.recorded === 0
          ? "No new possible duplicates found."
          : `Found ${result.data.recorded} possible duplicate pair${result.data.recorded === 1 ? "" : "s"}.`
        : result.error,
    );
    refresh();
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
      {/* ---- header --------------------------------------------------- */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="inline-block h-5 w-5 rounded-[5px] border-[2.5px] border-navy bg-accent" />
            <p className="eyebrow">Private dashboard</p>
          </div>
          <h1 className="mt-2 text-[28px] leading-tight font-bold text-navy sm:text-[34px]">
            Suggestion inbox
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-navy-soft sm:inline">{currentEmail}</span>
          <span
            title={live ? "Live updates on" : "Reconnecting — refreshing every 45 seconds"}
            className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-white px-2.5 py-1 text-[12px] font-medium text-navy-soft"
          >
            <span
              aria-hidden
              className={`h-[7px] w-[7px] rounded-full ${live ? "bg-emerald-500" : "bg-amber-400"}`}
            />
            {live ? "Live" : "Polling"}
          </span>
          <form action={signOut}>
            <button type="submit" className="btn-quiet">
              Sign out
            </button>
          </form>
        </div>
      </header>

      {/* ---- new arrivals banner -------------------------------------- */}
      <AnimatePresence>
        {arrivedCount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, y: -8, height: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div
              role="status"
              className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border-[1.5px] border-accent/45 bg-accent-wash px-4 py-3"
            >
              <p className="text-sm font-semibold text-accent-ink">
                {arrivedCount} new suggestion{arrivedCount === 1 ? "" : "s"} just arrived.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => {
                    setReadFilter("unread");
                    setSort("newest");
                    setArrivedCount(0);
                  }}
                >
                  Show unread
                </button>
                <button type="button" className="btn-quiet" onClick={() => setArrivedCount(0)}>
                  Dismiss
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---- stats ----------------------------------------------------- */}
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total suggestions" value={stats.total} />
        <Stat label="Unread" value={stats.unread} accent={stats.unread > 0} />
        <Stat label="Being discussed" value={stats.discussing} />
        <Stat label="Completed" value={stats.completed} />
      </div>

      {/* ---- toolbar --------------------------------------------------- */}
      <div className="paper mt-5 p-3.5 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-navy-soft">
              <SearchIcon />
            </span>
            <label htmlFor="panel-search" className="sr-only">
              Search suggestions
            </label>
            <input
              id="panel-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search titles, details, names…"
              className="field pl-9"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex">
            <Select
              label="Category"
              value={category}
              onChange={(v) => setCategory(v as Category | "all")}
              options={[
                { value: "all", label: "All categories" },
                ...CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
              ]}
            />
            <Select
              label="Status"
              value={status}
              onChange={(v) => setStatus(v as Status | "all")}
              options={[
                { value: "all", label: "All statuses" },
                ...STATUSES.map((s) => ({ value: s.value, label: s.label })),
              ]}
            />
            <Select
              label="Read state"
              value={readFilter}
              onChange={(v) => setReadFilter(v as ReadFilter)}
              options={[
                { value: "all", label: "Read & unread" },
                { value: "unread", label: "Unread only" },
                { value: "read", label: "Read only" },
              ]}
            />
            <Select
              label="Sort"
              value={sort}
              onChange={(v) => setSort(v as SortOrder)}
              options={[
                { value: "newest", label: "Newest first" },
                { value: "oldest", label: "Oldest first" },
              ]}
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule pt-3">
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-medium text-navy">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="h-4 w-4 accent-[#e24e1b]"
            />
            <span className="inline-flex items-center gap-1.5">
              <ArchiveIcon /> Include archived ({stats.archived})
            </span>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] font-medium text-navy">
            <input
              type="checkbox"
              checked={duplicatesOnly}
              onChange={(e) => setDuplicatesOnly(e.target.checked)}
              className="h-4 w-4 accent-[#e24e1b]"
            />
            <span>Possible duplicates ({stats.withDuplicates})</span>
          </label>
          <span className="text-[13px] text-navy-soft">
            Showing {visible.length} of {stats.total}
          </span>
          <button
            type="button"
            onClick={runRescan}
            disabled={rescanning}
            className="text-[13px] font-medium text-navy-soft underline underline-offset-2 hover:text-navy disabled:opacity-60"
          >
            {rescanning ? "Scanning…" : "Rescan for duplicates"}
          </button>
          {rescanNote && <span className="text-[13px] text-accent-ink">{rescanNote}</span>}
          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-[13px] font-medium text-accent-ink underline underline-offset-2"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* ---- list + detail --------------------------------------------- */}
      <div className={`mt-5 grid gap-5 ${selected ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]" : ""}`}>
        <div>
          {visible.length === 0 ? (
            <div className="paper px-6 py-16 text-center">
              <p className="font-display text-lg font-semibold text-navy">
                {stats.total === 0 ? "No suggestions yet" : "Nothing matches those filters"}
              </p>
              <p className="mx-auto mt-2 max-w-sm text-sm text-navy-soft">
                {stats.total === 0
                  ? "When a student puts an idea in the box, it will appear here straight away."
                  : "Try a different search, or clear the filters."}
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {visible.map((suggestion) => (
                <li key={suggestion.id}>
                  <SuggestionCard
                    suggestion={suggestion}
                    duplicateCount={duplicateCounts.get(suggestion.id) ?? 0}
                    relatedCount={relatedGroupSize(suggestion, suggestions)}
                    active={suggestion.id === selectedId}
                    onOpen={() => {
                      setSelectedId(suggestion.id);
                      setArrivedCount(0);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <AnimatePresence mode="wait">
          {selected && (
            <SuggestionDetail
              key={selected.id}
              suggestion={selected}
              allSuggestions={suggestions}
              matches={matches}
              currentEmail={currentEmail}
              refreshSignal={detailSignal}
              onOpenSuggestion={setSelectedId}
              onClose={() => setSelectedId(null)}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Stat({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`paper px-4 py-3.5 ${accent ? "border-accent/45" : ""}`}>
      <p className="text-[12px] font-semibold tracking-wide text-navy-soft uppercase">{label}</p>
      <p
        className={`mt-1 font-display text-[30px] leading-none font-bold tabular-nums ${
          accent ? "text-accent" : "text-navy"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="field w-full cursor-pointer py-[0.6rem] text-[13.5px] lg:w-auto"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function SuggestionCard({
  suggestion,
  duplicateCount,
  relatedCount,
  active,
  onOpen,
}: {
  suggestion: Suggestion;
  duplicateCount: number;
  relatedCount: number;
  active: boolean;
  onOpen: () => void;
}) {
  const unread = !suggestion.is_read;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? "true" : undefined}
      className={`paper relative w-full px-4 py-3.5 text-left transition-colors sm:px-5 ${
        active ? "border-navy/40 bg-paper-deep/40" : "hover:bg-paper-deep/35"
      }`}
    >
      {unread && (
        <span
          aria-hidden
          className="absolute top-0 bottom-0 left-0 w-[3.5px] rounded-l-[13px] bg-accent"
        />
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {unread && (
              <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-accent" aria-label="Unread" />
            )}
            <h3
              className={`truncate text-[15.5px] leading-snug ${
                unread ? "font-bold text-navy" : "font-semibold text-navy/80"
              }`}
            >
              {suggestion.title}
            </h3>
          </div>
          <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-relaxed text-navy-soft">
            {suggestion.description}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-navy-soft">
            <span className="rounded-full border border-rule px-2 py-0.5 font-medium">
              {CATEGORY_LABELS[suggestion.category]}
            </span>
            {duplicateCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-semibold text-amber-900">
                Possible duplicate
                <span className="tabular-nums">({duplicateCount})</span>
              </span>
            )}
            {suggestion.primary_suggestion_id && (
              <span className="rounded-full border border-navy/20 bg-navy/5 px-2 py-0.5 font-medium">
                Filed under another idea
              </span>
            )}
            {!suggestion.primary_suggestion_id && relatedCount > 1 && (
              <span className="rounded-full border border-navy/25 bg-navy/5 px-2 py-0.5 font-semibold text-navy">
                {relatedCount} related submissions
              </span>
            )}
            <span>
              <RelativeTime iso={suggestion.created_at} />
            </span>
            <span className="hidden sm:inline">
              <LocalTime iso={suggestion.created_at} />
            </span>
            <span className="font-medium">
              {suggestion.is_anonymous
                ? "Anonymous"
                : suggestion.student_name || suggestion.student_email || "No name"}
            </span>
          </div>
        </div>
        <StatusChip status={suggestion.status} className="mt-0.5 shrink-0" />
      </div>
    </button>
  );
}

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
import AIWorkspace from "./AIWorkspace";
import TrashPanel from "./TrashPanel";
import HelpPanel from "./HelpPanel";

type SortOrder = "newest" | "oldest";
type ReadFilter = "all" | "unread" | "read";
type PanelView = "inbox" | "workspace" | "trash" | "help";

const POLL_INTERVAL_MS = 45_000;

export default function PresidentPanel({
  suggestions,
  matches,
  currentEmail,
  meetingAgentConfigured,
}: {
  suggestions: Suggestion[];
  matches: SuggestionMatch[];
  currentEmail: string;
  meetingAgentConfigured: boolean;
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
  const [view, setView] = useState<PanelView>("inbox");

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

  const activeSuggestions = stats.total - stats.archived;
  const workflow = useMemo(
    () => [
      { status: "new" as const, label: "New", count: suggestions.filter((s) => s.status === "new").length, color: "bg-accent" },
      { status: "reviewing" as const, label: "Reviewing", count: suggestions.filter((s) => s.status === "reviewing").length, color: "bg-sky-500" },
      { status: "discussing" as const, label: "Discussing", count: stats.discussing, color: "bg-violet-500" },
      { status: "in_progress" as const, label: "In progress", count: suggestions.filter((s) => s.status === "in_progress").length, color: "bg-amber-500" },
      { status: "completed" as const, label: "Completed", count: stats.completed, color: "bg-emerald-500" },
    ],
    [suggestions, stats.discussing, stats.completed],
  );

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

  function showAll() {
    clearFilters();
  }

  function showUnread() {
    setQuery("");
    setCategory("all");
    setStatus("all");
    setReadFilter("unread");
    setShowArchived(false);
    setDuplicatesOnly(false);
  }

  function showStatus(next: Status) {
    setQuery("");
    setCategory("all");
    setStatus(next);
    setReadFilter("all");
    setShowArchived(next === "archived");
    setDuplicatesOnly(false);
  }

  function showDuplicates() {
    setQuery("");
    setCategory("all");
    setStatus("all");
    setReadFilter("all");
    setShowArchived(false);
    setDuplicatesOnly(true);
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
      <header className="dashboard-hero relative overflow-hidden rounded-[20px] px-5 py-6 text-white shadow-[0_18px_50px_-32px_rgba(16,25,53,0.9)] sm:px-7 sm:py-7">
        <span aria-hidden className="absolute -top-20 -right-14 h-52 w-52 rounded-full border-[36px] border-white/[0.035]" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="inline-block h-5 w-5 rounded-[5px] border-2 border-white/70 bg-accent" />
            <p className="text-[11.5px] font-bold tracking-[0.13em] text-orange-200 uppercase">Private dashboard</p>
          </div>
          <h1 className="mt-2 text-[30px] leading-tight font-bold text-white sm:text-[38px]">
            Suggestion inbox
          </h1>
          <p className="mt-1.5 text-sm text-white/65">
            {stats.unread > 0
              ? `${stats.unread} suggestion${stats.unread === 1 ? "" : "s"} waiting to be read`
              : "You’re caught up — no unread suggestions"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-white/65 sm:inline">{currentEmail}</span>
          <span
            title={live ? "Live updates on" : "Reconnecting — refreshing every 45 seconds"}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[12px] font-medium text-white/80"
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
        </div>
      </header>

      {/* ---- Inbox / AI Workspace navigation ---------------------------- */}
      <nav aria-label="Dashboard section" className="mt-5 flex gap-1.5 rounded-[12px] border border-rule bg-paper-deep/60 p-1.5">
        <button
          type="button"
          onClick={() => setView("inbox")}
          aria-current={view === "inbox" ? "page" : undefined}
          className={`flex-1 rounded-[9px] px-4 py-2.5 text-sm font-semibold transition-colors sm:flex-none sm:px-6 ${
            view === "inbox" ? "bg-white text-navy shadow-sm" : "text-navy-soft hover:text-navy"
          }`}
        >
          Inbox
        </button>
        <button
          type="button"
          onClick={() => setView("workspace")}
          aria-current={view === "workspace" ? "page" : undefined}
          className={`flex-1 rounded-[9px] px-4 py-2.5 text-sm font-semibold transition-colors sm:flex-none sm:px-6 ${
            view === "workspace" ? "bg-white text-navy shadow-sm" : "text-navy-soft hover:text-navy"
          }`}
        >
          AI Workspace
        </button>
        <button
          type="button"
          onClick={() => setView("trash")}
          aria-current={view === "trash" ? "page" : undefined}
          className={`flex-1 rounded-[9px] px-4 py-2.5 text-sm font-semibold transition-colors sm:flex-none sm:px-6 ${
            view === "trash" ? "bg-white text-navy shadow-sm" : "text-navy-soft hover:text-navy"
          }`}
        >
          Trash
        </button>
        <button
          type="button"
          onClick={() => setView("help")}
          aria-current={view === "help" ? "page" : undefined}
          className={`flex-1 rounded-[9px] px-4 py-2.5 text-sm font-semibold transition-colors sm:flex-none sm:px-6 ${
            view === "help" ? "bg-white text-navy shadow-sm" : "text-navy-soft hover:text-navy"
          }`}
        >
          Help
        </button>
      </nav>

      {view === "workspace" && (
        <AIWorkspace
          configured={meetingAgentConfigured}
          suggestions={suggestions}
          onOpenSuggestion={(id) => {
            setView("inbox");
            setSelectedId(id);
            setArrivedCount(0);
          }}
        />
      )}

      {view === "trash" && (
        <div className="mt-5">
          <TrashPanel onOpenHelp={() => setView("help")} />
        </div>
      )}

      {view === "help" && (
        <div className="mt-5">
          <HelpPanel />
        </div>
      )}

      {view === "inbox" && (
      <>
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
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="All suggestions" value={stats.total} active={!filtersActive} onClick={showAll} />
        <Stat label="Unread" value={stats.unread} accent={stats.unread > 0} active={readFilter === "unread"} onClick={showUnread} />
        <Stat label="Discussing" value={stats.discussing} active={status === "discussing"} onClick={() => showStatus("discussing")} />
        <Stat label="Possible duplicates" value={stats.withDuplicates} active={duplicatesOnly} onClick={showDuplicates} />
        <Stat label="Completed" value={stats.completed} active={status === "completed"} onClick={() => showStatus("completed")} />
      </div>

      <section className="paper mt-4 px-4 py-4 sm:px-5" aria-labelledby="workflow-heading">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="eyebrow">Progress</p>
            <h2 id="workflow-heading" className="mt-1 text-lg font-bold text-navy">Where ideas stand</h2>
          </div>
          <p className="text-[12.5px] text-navy-soft">{activeSuggestions} active · {stats.archived} archived</p>
        </div>
        <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-paper-deep" aria-hidden>
          {workflow.map((item) => item.count > 0 && (
            <span key={item.status} className={item.color} style={{ flexGrow: item.count }} />
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {workflow.map((item) => (
            <button key={item.status} type="button" onClick={() => showStatus(item.status)} className="group flex items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-paper-deep">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.color}`} aria-hidden />
              <span className="min-w-0 text-[12px] text-navy-soft"><strong className="text-navy tabular-nums">{item.count}</strong> {item.label}</span>
            </button>
          ))}
        </div>
      </section>

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
            title="New suggestions are checked for duplicates automatically as they arrive. This rechecks the older ones — use it after changing how matching works, or for suggestions submitted before duplicate detection existed."
            className="text-[13px] font-medium text-navy-soft underline decoration-dotted underline-offset-2 hover:text-navy disabled:opacity-60"
          >
            {rescanning ? "Scanning…" : "Scan existing suggestions"}
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
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="eyebrow">Inbox</p>
              <h2 className="mt-1 text-xl font-bold text-navy">
                {visible.length} suggestion{visible.length === 1 ? "" : "s"}
              </h2>
            </div>
            {filtersActive && (
              <button type="button" onClick={clearFilters} className="btn-quiet">
                Reset view
              </button>
            )}
          </div>
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
            <>
              <motion.button
                key="detail-backdrop"
                type="button"
                aria-label="Close suggestion details"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setSelectedId(null)}
                className="fixed inset-0 z-40 bg-navy/35 backdrop-blur-[2px] lg:hidden"
              />
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
            </>
          )}
        </AnimatePresence>
      </div>
      </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Stat({
  label,
  value,
  accent = false,
  active = false,
  onClick,
}: {
  label: string;
  value: number;
  accent?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`paper group min-h-[92px] px-4 py-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-navy/25 hover:shadow-md ${
        active ? "dashboard-stat-active border-navy text-white" : accent ? "border-accent/45" : ""
      }`}
    >
      <p className={`text-[12px] font-semibold tracking-wide uppercase ${active ? "text-white/75" : "text-navy-soft"}`}>
        {label}
      </p>
      <p
        className={`mt-1 font-display text-[30px] leading-none font-bold tabular-nums ${
          active ? "text-white" : accent ? "text-accent" : "text-navy"
        }`}
      >
        {value}
      </p>
      <span className={`mt-2 block text-[11px] font-semibold ${active ? "text-white/70" : "text-navy-soft/70"}`}>
        {active ? "Current view" : "View these"}
      </span>
    </button>
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

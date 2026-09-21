"use client";

import { useMemo, useState } from "react";
import type { Suggestion } from "@/lib/types";

/**
 * Lets a president attach real citations by searching suggestions already
 * loaded for the dashboard (so this never spends an extra round trip or an
 * AI credit). The selection here is only ever a convenience — every server
 * action re-validates every id against the database before saving anything.
 */
export default function SuggestionPicker({
  suggestions,
  selectedIds,
  onChange,
  disabled = false,
}: {
  suggestions: Suggestion[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selected = useMemo(
    () => selectedIds.map((id) => suggestions.find((s) => s.id === id)).filter((s): s is Suggestion => Boolean(s)),
    [suggestions, selectedIds],
  );
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return suggestions.filter((s) => !selectedSet.has(s.id) && s.title.toLowerCase().includes(needle)).slice(0, 8);
  }, [suggestions, query, selectedSet]);

  function add(id: string) {
    onChange([...selectedIds, id]);
    setQuery("");
  }
  function remove(id: string) {
    onChange(selectedIds.filter((x) => x !== id));
  }

  return (
    <div>
      <label htmlFor="citation-search" className="text-[13px] font-semibold text-navy">
        Cited suggestions
      </label>
      {selected.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {selected.map((s) => (
            <li key={s.id}>
              <span className="inline-flex max-w-[220px] items-center gap-1 rounded-full bg-violet-100 py-1 pr-1.5 pl-2.5 text-[11px] font-semibold text-violet-900">
                <span className="truncate">{s.title}</span>
                <button
                  type="button"
                  onClick={() => remove(s.id)}
                  disabled={disabled}
                  aria-label={`Remove citation: ${s.title}`}
                  className="shrink-0 rounded-full px-1 text-violet-700 hover:bg-violet-200 hover:text-violet-950"
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <input
        id="citation-search"
        type="text"
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search suggestions to cite…"
        className="field mt-2 text-[13px]"
        autoComplete="off"
      />
      {matches.length > 0 && (
        <ul className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border border-rule bg-white shadow-sm">
          {matches.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => add(s.id)}
                className="block w-full truncate px-3 py-2 text-left text-[13px] text-navy hover:bg-paper-deep"
              >
                {s.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

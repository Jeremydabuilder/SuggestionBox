"use client";

import { useEffect, useState } from "react";
import { STATUS_LABELS, STATUS_STYLES, type Status } from "@/lib/types";

export function StatusChip({ status, className = "" }: { status: Status; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold tracking-wide whitespace-nowrap ${STATUS_STYLES[status]} ${className}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Renders an absolute timestamp, formatted in the reader's own timezone. */
export function LocalTime({ iso, withTime = true }: { iso: string; withTime?: boolean }) {
  const [text, setText] = useState(() => iso.slice(0, 10));

  useEffect(() => {
    const date = new Date(iso);
    setText(
      date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
      }),
    );
  }, [iso, withTime]);

  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}

export function RelativeTime({ iso }: { iso: string }) {
  const [text, setText] = useState("");

  useEffect(() => {
    function compute() {
      const diff = Date.now() - new Date(iso).getTime();
      const minutes = Math.round(diff / 60000);
      if (minutes < 1) return "just now";
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.round(minutes / 60);
      if (hours < 24) return `${hours}h ago`;
      const days = Math.round(hours / 24);
      if (days < 30) return `${days}d ago`;
      return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
    setText(compute());
    const timer = setInterval(() => setText(compute()), 60000);
    return () => clearInterval(timer);
  }, [iso]);

  return (
    <span suppressHydrationWarning className="tabular-nums">
      {text}
    </span>
  );
}

/** Copies text and briefly confirms it. */
export function CopyButton({
  value,
  label,
  className = "btn-quiet",
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API blocked — fall back to a selectable prompt.
      window.prompt("Copy this address:", value);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button type="button" onClick={copy} className={className} aria-live="polite">
      {copied ? (
        <>
          <CheckIcon /> Copied
        </>
      ) : (
        <>
          <CopyIcon /> {label}
        </>
      )}
    </button>
  );
}

export function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="5.25" y="5.25" width="8.5" height="8.5" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.75 5.25v-1a2 2 0 0 0-2-2h-4.5a2 2 0 0 0-2 2v4.5a2 2 0 0 0 2 2h1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="m3.5 8.5 3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7.2" cy="7.2" r="4.7" stroke="currentColor" strokeWidth="1.6" />
      <path d="m10.8 10.8 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ArchiveIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="2.75" width="12" height="3" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.25 5.75v6a1.5 1.5 0 0 0 1.5 1.5h6.5a1.5 1.5 0 0 0 1.5-1.5v-6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 8.75h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

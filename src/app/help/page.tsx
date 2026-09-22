import type { Metadata } from "next";
import Link from "next/link";
import HelpBrowser from "./HelpBrowser";
import { STUDENT_HELP_TOPICS } from "@/lib/help-content";

export const metadata: Metadata = {
  title: "Help — Suggestion Box",
  description: "How the Suggestion Box works, what's stored, and how to submit an idea.",
};

export default function HelpPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14 print:max-w-none">
      <header className="flex items-center justify-between gap-4 print:hidden">
        <Link href="/" className="flex items-center gap-2.5">
          <span aria-hidden className="inline-block h-6 w-6 rounded-[6px] border-[2.5px] border-navy bg-accent" />
          <span className="font-display text-[15px] font-semibold tracking-tight text-navy">Student Government</span>
        </Link>
        <nav className="flex items-center gap-3 text-sm font-medium text-navy-soft">
          <Link href="/" className="underline-offset-4 hover:text-navy hover:underline">Home</Link>
          <span aria-hidden className="text-rule">·</span>
          <a href="/my-ideas" className="underline-offset-4 hover:text-navy hover:underline">My ideas</a>
        </nav>
      </header>

      <div className="mt-10">
        <p className="eyebrow">Help</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight text-navy sm:text-5xl">How the Suggestion Box works</h1>
        <p className="mt-3 max-w-xl text-[15.5px] leading-relaxed text-navy-soft">
          Everything below describes exactly what this app does today — nothing planned, nothing coming later.
        </p>
      </div>

      <HelpBrowser topics={STUDENT_HELP_TOPICS} />

      <div className="mt-10 rounded-[14px] border border-rule bg-white/70 p-5 print:hidden">
        <p className="text-sm font-semibold text-navy">Not sure this is the right place?</p>
        <p className="mt-1.5 text-sm leading-relaxed text-navy-soft">
          This box is for ideas and suggestions, read whenever a co-president gets to it — not for anything urgent. If you
          or someone else is in danger, or you need to report bullying, harassment, or a safety concern, please talk to a
          teacher, counselor, or administrator directly, or use your school&rsquo;s normal safety-reporting channel instead.
        </p>
      </div>

      <p className="mt-10 text-center text-sm text-navy-soft print:hidden">
        <Link href="/" className="underline-offset-4 hover:text-navy hover:underline">Back to the Suggestion Box</Link>
      </p>
    </main>
  );
}

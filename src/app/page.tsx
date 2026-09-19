import type { Metadata } from "next";
import SubmissionFlow from "@/components/SubmissionFlow";

export const metadata: Metadata = {
  title: "Have an idea? Put it in the box.",
  description:
    "Share an idea with the student-government co-presidents. Events, food, school spaces, clubs, community — anything that would make our school better.",
};

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-24 pt-10 sm:px-8 sm:pt-16">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="inline-block h-6 w-6 rounded-[6px] border-[2.5px] border-navy bg-accent"
          />
          <span className="font-display text-[15px] font-semibold tracking-tight text-navy">
            Student Government
          </span>
        </div>
        <a
          href="/president"
          className="text-sm font-medium text-navy-soft underline-offset-4 hover:text-navy hover:underline"
        >
          President sign-in
        </a>
      </header>

      <section className="mx-auto mt-16 max-w-3xl text-center sm:mt-24">
        <p className="eyebrow">The suggestion box</p>
        <h1 className="mt-4 text-[2.6rem] leading-[1.03] font-bold tracking-tight text-navy sm:text-6xl">
          Have an idea?
          <br />
          <span className="relative inline-block">
            Put it in the box.
            <span
              aria-hidden
              className="absolute -bottom-1.5 left-0 h-[6px] w-full rounded-full bg-accent/35 sm:-bottom-2 sm:h-[9px]"
            />
          </span>
        </h1>
        <p className="mx-auto mt-7 max-w-xl text-[17px] leading-relaxed text-navy-soft">
          Better lunches, a new club, somewhere decent to sit at break — if it would make this
          school better, we want to hear it. Your suggestion goes straight to the
          co-presidents.
        </p>
      </section>

      {/* Tighter on a phone, where this gap is what separates the intro
          from the box once the success state replaces the form. */}
      <div className="mt-9 sm:mt-20">
        <SubmissionFlow />
      </div>

      <footer className="mt-24 border-t border-rule pt-8 text-center text-sm text-navy-soft">
        <p className="mx-auto max-w-xl">
          Run by the Student Government co-presidents. Suggestions are kept private and
          reviewed only for Student Government purposes.
        </p>
      </footer>
    </main>
  );
}

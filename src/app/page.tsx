import type { Metadata } from "next";
import SubmissionFlow from "@/components/SubmissionFlow";

export const metadata: Metadata = {
  title: "Have an idea? Put it in the box.",
  description:
    "Share an idea with the student-government co-presidents. Events, food, school spaces, clubs, community — anything that would make our school better.",
};

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-5xl overflow-hidden px-5 pb-24 pt-7 sm:px-8 sm:pt-10">
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
        <nav className="flex items-center gap-3 text-sm font-medium text-navy-soft">
          <a href="/my-ideas" className="underline-offset-4 hover:text-navy hover:underline">My ideas</a>
          <span aria-hidden className="text-rule">·</span>
          <a href="/help" className="underline-offset-4 hover:text-navy hover:underline">Help</a>
          <span aria-hidden className="text-rule">·</span>
          <a href="/president" className="underline-offset-4 hover:text-navy hover:underline">President sign-in</a>
        </nav>
      </header>

      <section className="hero-enter mx-auto mt-14 max-w-4xl text-center sm:mt-20">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-rule bg-white px-3 py-1.5 text-[12px] font-semibold text-navy-soft shadow-sm">
          <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
          Open for ideas from every middle schooler
        </div>
        <h1 className="mt-5 text-[2.8rem] leading-[0.98] font-bold tracking-tight text-navy sm:text-7xl">
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
        <p className="mx-auto mt-7 max-w-2xl text-[17px] leading-relaxed text-navy-soft sm:text-[19px]">
          Better snacks, no more metal detectors, or simply more fun—if it could make your
          middle school life better, we want to hear it. Your suggestion goes straight to the
          co-presidents.
        </p>
      </section>

      {/* Tighter on a phone, where this gap is what separates the intro
          from the box once the success state replaces the form. Sized to
          the paragraph alone now that the example-idea pills are gone. */}
      <div className="mt-8 sm:mt-14">
        <SubmissionFlow />
      </div>

      <figure className="mx-auto mt-20 max-w-2xl text-center sm:mt-28">
        <div aria-hidden className="mx-auto mb-5 h-px w-16 bg-accent" />
        <blockquote className="font-display text-[25px] leading-snug font-semibold text-navy sm:text-[32px]">
          “Alone we can do so little; together we can do so much.”
        </blockquote>
        <figcaption className="mt-3 text-sm font-medium text-navy-soft">— Helen Keller</figcaption>
      </figure>

      <footer className="mt-20 grid gap-4 border-t border-rule pt-8 text-sm text-navy-soft sm:grid-cols-3 sm:text-left">
        <p><strong className="block text-navy">Private by default</strong>Your idea is only available to the co-presidents.</p>
        <p><strong className="block text-navy">Never posted publicly</strong>Your name and school email verify you&rsquo;re a real student — they&rsquo;re never shown to anyone but the co-presidents.</p>
        <p><strong className="block text-navy">Ideas aren&rsquo;t deleted lightly</strong>Similar ideas can be grouped. A co-president can remove one in rare cases, always recoverable first.</p>
      </footer>
      <p className="mt-6 text-center text-sm text-navy-soft">
        <a href="/help" className="underline-offset-4 hover:text-navy hover:underline">How this works &amp; your privacy</a>
      </p>
    </main>
  );
}

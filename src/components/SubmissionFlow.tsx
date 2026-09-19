"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useAnimate, useReducedMotion } from "framer-motion";
import SuggestionBoxArt from "./SuggestionBoxArt";
import Turnstile from "./Turnstile";
import { CATEGORIES, type Category } from "@/lib/types";
import { LIMITS, MINIMUMS } from "@/lib/validation";
import { publicEnv } from "@/lib/env";

type Phase = "form" | "sending" | "animating" | "done";

interface FormState {
  title: string;
  description: string;
  category: Category | "";
  improvementReason: string;
  studentName: string;
  studentEmail: string;
  isAnonymous: boolean;
}

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  category: "",
  improvementReason: "",
  studentName: "",
  studentEmail: "",
  isAnonymous: false,
};

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Height of the folded sheet, and of the stage once the form collapses. */
const STAGE_HEIGHT = 184;

/** How small the folded note is by the time it reaches the slot. */
const FLY_SCALE = 0.5;

export default function SubmissionFlow() {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const prefersReducedMotion = useReducedMotion();

  const [phase, setPhase] = useState<Phase>("form");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [runId, setRunId] = useState(0);
  const [paperTitle, setPaperTitle] = useState("");

  const paperAreaRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const successCardRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  // The card is absolutely positioned so it can fly away without disturbing
  // the page, which means the stage has to carry its height. A CSS
  // transition on that height is what closes the gap to the box mid-flight.
  useEffect(() => {
    const area = paperAreaRef.current;
    const target = phase === "done" ? successCardRef.current : paperRef.current;
    if (!area || !target) return;
    if (phase !== "form" && phase !== "done") return;

    const apply = () => {
      area.style.height = `${target.offsetHeight}px`;
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(target);
    return () => observer.disconnect();
  }, [phase, runId]);

  const update = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setErrors((prev) => {
        if (!prev[key as string]) return prev;
        const next = { ...prev };
        delete next[key as string];
        return next;
      });
    },
    [],
  );

  /** Client-side checks that mirror the server's. The server is authoritative. */
  function validate(): Record<string, string> {
    const next: Record<string, string> = {};
    const title = form.title.trim();
    const description = form.description.trim();
    const reason = form.improvementReason.trim();

    if (title.length < MINIMUMS.title) next.title = "Give your idea a short title.";
    else if (title.length > LIMITS.title) next.title = "That title is a bit long.";

    if (description.length < MINIMUMS.description)
      next.description = `Tell us a little more — at least ${MINIMUMS.description} characters.`;

    if (!form.category) next.category = "Pick a category.";

    if (reason.length < MINIMUMS.improvementReason)
      next.improvementReason = "Say how this would make school better.";

    if (!form.isAnonymous && form.studentEmail.trim()) {
      const email = form.studentEmail.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
        next.studentEmail = "That doesn't look like an email address.";
    }
    return next;
  }

  async function playAnimation() {
    const root = scope.current;
    if (!root) return;

    const paper = root.querySelector<HTMLElement>("[data-paper]");
    const foldV = root.querySelector<HTMLElement>("[data-fold-v]");
    const sheet = root.querySelector<HTMLElement>("[data-sheet]");
    const slide = root.querySelector<HTMLElement>("[data-slide]");
    const slot = root.querySelector<HTMLElement>("[data-slot]");
    if (!paper || !foldV || !sheet || !slide || !slot) return;

    const area = paperAreaRef.current;

    // Freeze the current size so width/height are animatable numbers.
    paper.style.width = `${paper.offsetWidth}px`;
    sheet.style.height = `${sheet.offsetHeight}px`;
    if (area) area.style.height = `${paper.offsetHeight}px`;

    // Make sure the box is actually on screen before anything flies at it.
    root.scrollIntoView({ behavior: "smooth", block: "center" });
    await new Promise((resolve) => setTimeout(resolve, 420));

    // 1 — the form becomes a sheet of paper, and the stage closes up around
    // it so the paper and the box share the screen.
    await animate("[data-form-body]", { opacity: 0, y: -6 }, { duration: 0.24, ease: "easeIn" });
    if (area) area.style.height = `${STAGE_HEIGHT}px`;
    await Promise.all([
      animate("[data-paper]", { width: 268 }, { duration: 0.5, ease: EASE_OUT }),
      animate("[data-sheet]", { height: STAGE_HEIGHT }, { duration: 0.5, ease: EASE_OUT }),
      animate("[data-paper-face]", { opacity: 1 }, { duration: 0.3, delay: 0.12 }),
    ]);
    root.scrollIntoView({ behavior: "smooth", block: "center" });

    // 2 — fold it: once across, once down the side.
    await Promise.all([
      animate("[data-fold-v]", { scaleY: 0.52 }, { duration: 0.34, ease: EASE_OUT }),
      animate("[data-crease-h]", { opacity: 1 }, { duration: 0.2 }),
    ]);
    await Promise.all([
      animate("[data-sheet]", { scaleX: 0.6 }, { duration: 0.3, ease: EASE_OUT }),
      animate("[data-crease-v]", { opacity: 1 }, { duration: 0.18 }),
    ]);
    // Pin rotation to the folded sheet's own centre, not the wrapper's, so
    // the paper lands exactly on the slot. Done before any transform is
    // applied to [data-paper], so nothing jumps.
    const sheetRect = sheet.getBoundingClientRect();
    const paperRect = paper.getBoundingClientRect();
    const sheetCenterX = sheetRect.left + sheetRect.width / 2;
    const sheetCenterY = sheetRect.top + sheetRect.height / 2;
    paper.style.transformOrigin = `${sheetCenterX - paperRect.left}px ${
      sheetCenterY - paperRect.top
    }px`;

    // Shrink on the way so the note is narrower than the slot it goes into.
    // Scaling about the pinned centre lifts the bottom edge, so add it back.
    const slotRect = slot.getBoundingClientRect();
    const dx = slotRect.left + slotRect.width / 2 - sheetCenterX;
    const dy =
      slotRect.top + slotRect.height / 2 -
      sheetRect.bottom +
      6 +
      ((1 - FLY_SCALE) * sheetRect.height) / 2;

    await animate("[data-paper]", { rotate: -3 }, { duration: 0.18, ease: "easeOut" });

    // 3 — carry it over to the box, landing bottom-edge first on the slot.
    await animate(
      "[data-paper]",
      {
        x: [0, dx * 0.55, dx],
        y: [0, dy * 0.3, dy],
        rotate: [-3, -9, -2],
        scale: [1, 0.78, FLY_SCALE],
      },
      { duration: 0.78, ease: [0.34, 0.8, 0.3, 1] },
    );

    // 4 — slide it into the slot (the box is drawn above the paper).
    await animate(
      "[data-slide]",
      { y: 22, scaleY: 0 },
      { duration: 0.42, ease: [0.55, 0, 0.6, 1] },
    );

    // 5 — the box takes it with a small bounce.
    await animate(
      "[data-box]",
      { y: [0, 7, -4, 2, 0], scaleY: [1, 0.95, 1.03, 0.99, 1], scaleX: [1, 1.04, 0.98, 1.01, 1] },
      { duration: 0.62, ease: "easeOut" },
    );

    setPhase("done");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase !== "form") return;

    setFormError(null);
    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      const firstKey = Object.keys(nextErrors)[0]!;
      document.getElementById(firstKey)?.focus();
      return;
    }

    if (publicEnv.turnstileSiteKey && !turnstileToken) {
      setFormError("Just a moment — we're still confirming you're a person.");
      return;
    }

    setPhase("sending");
    try {
      const response = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          category: form.category,
          improvementReason: form.improvementReason.trim(),
          isAnonymous: form.isAnonymous,
          studentName: form.isAnonymous ? "" : form.studentName.trim(),
          studentEmail: form.isAnonymous ? "" : form.studentEmail.trim(),
          turnstileToken: turnstileToken ?? undefined,
          website: "",
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          fields?: Record<string, string>;
        };
        if (data.fields) setErrors(data.fields);
        setFormError(data.error ?? "Something went wrong. Please try again.");
        setPhase("form");
        setTurnstileReset((n) => n + 1);
        return;
      }

      // Saved and confirmed by the database — only now do we celebrate.
      setPaperTitle(form.title.trim());
      setPhase("animating");
      if (prefersReducedMotion) {
        setPhase("done");
      } else {
        await playAnimation();
      }
    } catch {
      setFormError("We couldn't reach the server. Check your connection and try again.");
      setPhase("form");
      setTurnstileReset((n) => n + 1);
    }
  }

  useEffect(() => {
    if (phase === "done") successRef.current?.focus();
  }, [phase]);

  function submitAnother() {
    setForm(EMPTY_FORM);
    setErrors({});
    setFormError(null);
    setPaperTitle("");
    setTurnstileToken(null);
    setTurnstileReset((n) => n + 1);
    setPhase("form");
    setRunId((n) => n + 1);
    requestAnimationFrame(() => {
      const area = paperAreaRef.current;
      const paper = paperRef.current;
      if (area && paper) area.style.height = `${paper.offsetHeight}px`;
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  const busy = phase === "sending" || phase === "animating";
  const showForm = phase === "form" || phase === "sending" || phase === "animating";

  return (
    <div ref={scope} className="relative">
      <div
        ref={paperAreaRef}
        className="relative transition-[height] duration-[420ms] ease-out"
      >
        {showForm && (
            <div
              key={runId}
              data-paper
              ref={paperRef}
              className="absolute inset-x-0 top-0 mx-auto w-full max-w-2xl will-change-transform"
            >
              <div data-fold-v className="origin-top will-change-transform">
                <div data-slide className="origin-bottom will-change-transform">
                  <div
                    data-sheet
                    className="paper relative origin-left overflow-hidden will-change-transform"
                  >
                    {/* --- the actual form ------------------------------ */}
                    <div data-form-body className="p-6 sm:p-9">
                      <SuggestionFormFields
                        form={form}
                        errors={errors}
                        formError={formError}
                        busy={busy}
                        onChange={update}
                        onSubmit={handleSubmit}
                        onToken={setTurnstileToken}
                        turnstileReset={turnstileReset}
                      />
                    </div>

                    {/* --- what it becomes: a folded sheet -------------- */}
                    <div
                      data-paper-face
                      aria-hidden
                      className="pointer-events-none absolute inset-0 flex flex-col justify-between p-6 opacity-0"
                    >
                      <div>
                        <p className="eyebrow">My idea</p>
                        <p className="mt-2 line-clamp-2 font-display text-lg leading-snug font-semibold text-navy">
                          {paperTitle}
                        </p>
                      </div>
                      <div className="space-y-2.5" aria-hidden>
                        {[92, 100, 78, 96, 60].map((w, i) => (
                          <div
                            key={i}
                            className="h-[3px] rounded-full bg-navy/12"
                            style={{ width: `${w}%` }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* --- fold creases --------------------------------- */}
                    <div
                      data-crease-h
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-navy/25 opacity-0"
                    />
                    <div
                      data-crease-v
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 left-[60%] w-px bg-navy/20 opacity-0"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

        {/* --- the success message sits where the form was ------------- */}
        <AnimatePresence>
          {phase === "done" && (
            <motion.div
              ref={successCardRef}
              initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: EASE_OUT, delay: prefersReducedMotion ? 0 : 0.1 }}
              className="paper absolute inset-x-0 top-0 mx-auto max-w-2xl p-8 text-center sm:p-12"
            >
              <p className="eyebrow">Delivered</p>
              <h2
                ref={successRef}
                tabIndex={-1}
                className="mt-3 text-3xl font-bold text-navy outline-none sm:text-4xl"
              >
                Your idea is in the box!
              </h2>
              <p className="mx-auto mt-4 max-w-md text-navy-soft">
                Our co-presidents read every suggestion in their dashboard. Thanks for helping
                make this school better.
              </p>
              <button type="button" onClick={submitAnother} className="btn-primary mt-8">
                Submit another idea
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* --- the box itself ------------------------------------------- */}
      <div className="mt-14 flex justify-center">
        <div className="relative z-20 w-[240px] sm:w-[280px]">
          <div data-box className="will-change-transform">
            <SuggestionBoxArt className="w-full" />
          </div>
          {/* invisible marker: the centre of the slot */}
          <span
            data-slot
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-[32.4%] block h-[4px] w-[4px] -translate-x-1/2"
          />
        </div>
      </div>
      <p className="mt-5 text-center text-sm text-navy-soft">
        Every idea lands in the co-presidents&rsquo; private dashboard.
      </p>

      <span aria-live="polite" className="sr-only">
        {phase === "sending" ? "Sending your suggestion" : ""}
        {phase === "done" ? "Your idea is in the box" : ""}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form fields                                                         */
/* ------------------------------------------------------------------ */

function SuggestionFormFields({
  form,
  errors,
  formError,
  busy,
  onChange,
  onSubmit,
  onToken,
  turnstileReset,
}: {
  form: FormState;
  errors: Record<string, string>;
  formError: string | null;
  busy: boolean;
  onChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onToken: (token: string | null) => void;
  turnstileReset: number;
}) {
  return (
    <form onSubmit={onSubmit} noValidate>
      {/* honeypot — hidden from people, irresistible to bots */}
      <div aria-hidden className="absolute left-[-9999px] top-0 h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="space-y-6">
        <Field
          id="title"
          label="What's your idea?"
          error={errors.title}
          count={form.title.length}
          max={LIMITS.title}
        >
          <input
            id="title"
            name="title"
            type="text"
            value={form.title}
            maxLength={LIMITS.title}
            disabled={busy}
            onChange={(e) => onChange("title", e.target.value)}
            placeholder="Bring back the Friday spirit assembly"
            className={`field ${errors.title ? "field-error" : ""}`}
            autoComplete="off"
          />
        </Field>

        <Field
          id="description"
          label="Tell us more"
          hint="What exactly are you picturing?"
          error={errors.description}
          count={form.description.length}
          max={LIMITS.description}
        >
          <textarea
            id="description"
            name="description"
            rows={5}
            value={form.description}
            maxLength={LIMITS.description}
            disabled={busy}
            onChange={(e) => onChange("description", e.target.value)}
            placeholder="Describe your idea — the more detail, the easier it is for us to make it happen."
            className={`field resize-y ${errors.description ? "field-error" : ""}`}
          />
        </Field>

        <Field id="category" label="Category" error={errors.category}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CATEGORIES.map((category) => {
              const selected = form.category === category.value;
              return (
                <button
                  key={category.value}
                  type="button"
                  disabled={busy}
                  aria-pressed={selected}
                  onClick={() => onChange("category", category.value)}
                  className={`rounded-[10px] border px-3 py-2.5 text-sm font-medium transition-colors ${
                    selected
                      ? "border-accent bg-accent text-white"
                      : "border-rule bg-white text-navy hover:border-[#d8ccba] hover:bg-paper-deep"
                  }`}
                >
                  {category.label}
                </button>
              );
            })}
          </div>
          {/* keeps the field focusable for validation messages */}
          <input
            type="text"
            id="category-value"
            value={form.category}
            readOnly
            tabIndex={-1}
            aria-hidden
            className="sr-only"
          />
        </Field>

        <Field
          id="improvementReason"
          label="Why would this make our school better?"
          error={errors.improvementReason}
          count={form.improvementReason.length}
          max={LIMITS.improvementReason}
        >
          <textarea
            id="improvementReason"
            name="improvementReason"
            rows={3}
            value={form.improvementReason}
            maxLength={LIMITS.improvementReason}
            disabled={busy}
            onChange={(e) => onChange("improvementReason", e.target.value)}
            placeholder="Who would it help, and how?"
            className={`field resize-y ${errors.improvementReason ? "field-error" : ""}`}
          />
        </Field>

        {/* ---- identity (entirely optional) ---- */}
        <div className="rounded-[12px] border border-rule bg-paper-deep/50 p-4 sm:p-5">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={form.isAnonymous}
              disabled={busy}
              onChange={(e) => onChange("isAnonymous", e.target.checked)}
              className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-[#e24e1b]"
            />
            <span className="text-sm">
              <span className="font-semibold text-navy">Submit without my name</span>
              <span className="mt-0.5 block text-navy-soft">
                Your idea arrives completely anonymously. We won&rsquo;t be able to reach you
                about it.
              </span>
            </span>
          </label>

          <AnimatePresence initial={false}>
            {!form.isAnonymous && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: EASE_OUT }}
                className="overflow-hidden"
              >
                <div className="grid gap-4 pt-5 sm:grid-cols-2">
                  <Field id="studentName" label="Name" hint="Optional" error={errors.studentName}>
                    <input
                      id="studentName"
                      name="studentName"
                      type="text"
                      value={form.studentName}
                      maxLength={LIMITS.name}
                      disabled={busy}
                      onChange={(e) => onChange("studentName", e.target.value)}
                      placeholder="Jordan R."
                      className={`field ${errors.studentName ? "field-error" : ""}`}
                      autoComplete="name"
                    />
                  </Field>
                  <Field
                    id="studentEmail"
                    label="Email"
                    hint="Optional"
                    error={errors.studentEmail}
                  >
                    <input
                      id="studentEmail"
                      name="studentEmail"
                      type="email"
                      value={form.studentEmail}
                      maxLength={LIMITS.email}
                      disabled={busy}
                      onChange={(e) => onChange("studentEmail", e.target.value)}
                      placeholder="you@school.org"
                      className={`field ${errors.studentEmail ? "field-error" : ""}`}
                      autoComplete="email"
                    />
                  </Field>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <p className="text-[13px] leading-relaxed text-navy-soft">
          <span className="font-semibold text-navy">Your privacy.</span> Only the two
          student-government co-presidents can read suggestions. Nothing you write is shown
          publicly, and there&rsquo;s no voting or commenting. If you leave your name or email
          out, we have no way of knowing who sent it.
        </p>

        <Turnstile onToken={onToken} resetSignal={turnstileReset} />

        {formError && (
          <p
            role="alert"
            className="rounded-[10px] border border-[#f0c4bb] bg-[#fdeee7] px-4 py-3 text-sm font-medium text-[#8d2b0d]"
          >
            {formError}
          </p>
        )}

        <button type="submit" disabled={busy} className="btn-primary w-full text-base sm:w-auto">
          {busy ? (
            <>
              <Spinner />
              Putting it in the box…
            </>
          ) : (
            "Put it in the box"
          )}
        </button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  count,
  max,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  count?: number;
  max?: number;
  children: React.ReactNode;
}) {
  const showCount = typeof count === "number" && typeof max === "number";
  const near = showCount && count > max * 0.9;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-navy">
          {label}
          {hint && <span className="ml-2 font-normal text-navy-soft">{hint}</span>}
        </label>
        {showCount && (
          <span
            className={`shrink-0 text-xs tabular-nums ${near ? "text-accent-ink" : "text-navy-soft/70"}`}
          >
            {count}/{max}
          </span>
        )}
      </div>
      {children}
      {error && (
        <p role="alert" className="mt-1.5 text-sm font-medium text-[#b23417]">
          {error}
        </p>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
    />
  );
}

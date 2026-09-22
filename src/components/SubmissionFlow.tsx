"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, useAnimate, useReducedMotion } from "framer-motion";
import SuggestionBoxArt, { SLOT_BOX } from "./SuggestionBoxArt";
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
}

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  category: "",
  improvementReason: "",
  studentName: "",
};

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/**
 * The sheet the form becomes, before it is folded. Portrait, in letter
 * proportions, so that folding it in thirds leaves a note shaped like a
 * real folded note — tall enough to read as one standing in the slot.
 */
const SHEET_W = 200;
const SHEET_H = 260;

/** A letter folded in thirds keeps its width and loses two thirds of its height. */
const FOLD_TWO_THIRDS = 0.665;
const FOLD_ONE_THIRD = 0.338;

/**
 * What the stage closes down to once the note is folded. The fold collapses
 * towards the top of the sheet, so the note ends up at the top of the stage
 * and there is no dead space between it and the box.
 */
const FOLDED_STAGE_H = 96;

/** How the note sits relative to the slot it has to fit through. */
const SLOT_FILL = 0.82;
/**
 * How far the note leans back as it reaches the slot. A note being posted
 * stands close to upright in the slot — it does not lie down on the lid —
 * so this is a lean, not a flattening.
 */
const LID_TILT_DEG = 16;

/**
 * Timing curves. In a cubic bezier the x control points must not go
 * backwards (x1 <= x2) — otherwise the curve is non-monotonic in time and
 * the value sails past its target and returns, which on a flight path looks
 * like the note overshooting the box.
 */
const TRAVEL_EASE = [0.32, 0.64, 0.36, 1] as const;
const TURN_EASE = [0.4, 0.15, 0.6, 1] as const;

/** Descent into the slot. y and the clip run on this exact curve, together. */
const INSERT_EASE = [0.45, 0.05, 0.55, 1] as const;

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
  // undefined = still checking; null = confirmed signed out; string = signed in.
  const [viewerEmail, setViewerEmail] = useState<string | null | undefined>(undefined);

  const compositionRef = useRef<HTMLDivElement>(null);
  const paperAreaRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const successCardRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/me", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((result: { email?: string | null }) => setViewerEmail(result.email ?? null))
      .catch(() => setViewerEmail(null));
    return () => controller.abort();
  }, []);

  // The paper is absolutely positioned so it can fly away without disturbing
  // the page, which means the stage has to carry its height. A CSS
  // transition on that height is what closes the gap to the box mid-flight.
  // Once the note is in, the stage is gone and the message takes its place.
  useEffect(() => {
    if (phase !== "form") return;
    const area = paperAreaRef.current;
    const paper = paperRef.current;
    if (!area || !paper) return;

    const apply = () => {
      area.style.height = `${paper.offsetHeight}px`;
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(paper);
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

    if (!form.studentName.trim()) next.studentName = "Enter your name.";

    return next;
  }

  async function playAnimation() {
    const root = scope.current;
    if (!root) return;

    const find = (selector: string) => root.querySelector<HTMLElement>(selector);
    const paper = find("[data-paper]");
    const tilt = find("[data-tilt]");
    const sheet = find("[data-sheet]");
    const slot = find("[data-slot]");
    if (!paper || !tilt || !sheet || !slot) return;

    const area = paperAreaRef.current;

    // Freeze the current size so width/height become animatable numbers.
    paper.style.width = `${paper.offsetWidth}px`;
    sheet.style.height = `${sheet.offsetHeight}px`;
    if (area) area.style.height = `${paper.offsetHeight}px`;

    // Bring the box into view first: the paper and the box have to share the
    // screen for the part of this that matters.
    root.scrollIntoView({ behavior: "smooth", block: "center" });

    // 1 — the form becomes a sheet of paper and lifts off the page. The
    //     stage closes up at the same time so the box comes to meet it.
    await animate("[data-form-body]", { opacity: 0, y: -6 }, { duration: 0.2, ease: "easeIn" });
    if (area) area.style.height = `${FOLDED_STAGE_H}px`;
    sheet.classList.add("paper-lifted");
    await Promise.all([
      animate("[data-paper]", { width: SHEET_W }, { duration: 0.36, ease: EASE_OUT }),
      animate("[data-sheet]", { height: SHEET_H }, { duration: 0.36, ease: EASE_OUT }),
      animate("[data-paper-face]", { opacity: 1 }, { duration: 0.24, delay: 0.08 }),
      animate("[data-tilt]", { y: -14, scale: 1.04 }, { duration: 0.36, ease: EASE_OUT }),
    ]);

    // 2 — fold it in thirds, the way you fold a letter.
    await Promise.all([
      animate("[data-fold]", { scaleY: FOLD_TWO_THIRDS }, { duration: 0.18, ease: EASE_OUT }),
      animate("[data-crease-1]", { opacity: 1 }, { duration: 0.14 }),
    ]);
    await Promise.all([
      animate("[data-fold]", { scaleY: FOLD_ONE_THIRD }, { duration: 0.2, ease: EASE_OUT }),
      animate("[data-crease-2]", { opacity: 1 }, { duration: 0.14 }),
    ]);

    // Scale and rotateX act about the element's transform origin. The folded
    // note sits in the TOP of a full-height sheet, so the default centre
    // origin would drag it downwards as it shrinks. Pin the origin to the
    // folded note's own centre instead: then its centre is the one point
    // that does not move, and the landing position can be worked out up
    // front. Set before any transform is applied, so nothing jumps.
    tilt.style.transformOrigin = `50% ${(SHEET_H * FOLD_ONE_THIRD) / 2}px`;

    // 3 — carry it to the box. The note shrinks to the slot's width and
    //     tips into the plane of the lid ON THE WAY, so it reads as moving
    //     away from you rather than jumping to a smaller size in place.
    //
    const slotRect = slot.getBoundingClientRect();
    const foldedRect = sheet.getBoundingClientRect();
    const scale = (slotRect.width * SLOT_FILL) / foldedRect.width;
    const tiltedHeight =
      foldedRect.height * scale * Math.cos((LID_TILT_DEG * Math.PI) / 180);

    const dx = slotRect.left + slotRect.width / 2 - (foldedRect.left + foldedRect.width / 2);
    const dy =
      slotRect.bottom - tiltedHeight / 2 - (foldedRect.top + foldedRect.height / 2);

    await Promise.all([
      animate(
        "[data-paper]",
        { x: [0, dx * 0.62, dx], y: [0, dy * 0.3, dy] },
        { duration: 0.52, ease: TRAVEL_EASE },
      ),
      animate(
        "[data-tilt]",
        { scale, rotateX: LID_TILT_DEG, rotate: 0 },
        { duration: 0.52, ease: TURN_EASE },
      ),
      animate("[data-contact-shadow]", { opacity: [0, 0.18, 0.6] }, { duration: 0.52 }),
    ]);

    // 4 — close the last pixel or two. Perspective foreshortening isn't
    //     exactly cos(tilt), so measure what actually landed and correct it
    //     before the note goes in. Alignment with the slot has to be exact.
    const landed = sheet.getBoundingClientRect();
    const driftX = slotRect.left + slotRect.width / 2 - (landed.left + landed.width / 2);
    const driftY = slotRect.bottom - landed.bottom;
    if (Math.abs(driftX) > 0.5 || Math.abs(driftY) > 0.5) {
      await animate(
        "[data-paper]",
        { x: dx + driftX, y: dy + driftY },
        { duration: 0.1, ease: "linear" },
      );
    }

    // 5 — in it goes. The note travels down by exactly its own on-screen
    //     height while the clip eats it from the bottom on the same curve,
    //     so its front edge stays pinned to the slot's lip and the rest
    //     disappears inside the box. Nothing crosses the front wall.
    const descent = sheet.getBoundingClientRect().height;
    const restY = dy + driftY;
    await Promise.all([
      animate(
        "[data-paper]",
        { y: restY + descent },
        { duration: 0.36, ease: INSERT_EASE },
      ),
      animate(
        "[data-sheet]",
        { clipPath: "inset(0% 0% 100% 0%)" },
        { duration: 0.36, ease: INSERT_EASE },
      ),
      animate("[data-slot-sliver]", { opacity: [0, 1] }, { duration: 0.22 }),
      animate("[data-contact-shadow]", { opacity: [0.6, 0.28, 0] }, { duration: 0.36 }),
    ]);

    // 6 — the box takes the weight. A settle, not a cartoon bounce.
    await Promise.all([
      animate(
        "[data-box]",
        { y: [0, 3.4, -1.4, 0.7, 0], scaleY: [1, 0.987, 1.007, 0.997, 1] },
        { duration: 0.3, ease: "easeOut" },
      ),
      animate("[data-box-label]", { y: [0, 1.6, -0.5, 0] }, { duration: 0.3, ease: "easeOut" }),
    ]);
    void animate("[data-slot-sliver]", { opacity: 0 }, { duration: 0.45, delay: 0.1 });

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
          studentName: form.studentName.trim(),
          turnstileToken: turnstileToken ?? undefined,
          website: "",
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          fields?: Record<string, string>;
          code?: string;
        };
        if (data.code === "sign_in_required") {
          window.location.href = "/my-ideas/login";
          return;
        }
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
    if (phase !== "done") return;
    // Focus without scrolling, then bring the WHOLE composition into view —
    // box, message and button together. On a phone the button is the last
    // thing to arrive and the easiest to leave below the fold.
    successRef.current?.focus({ preventScroll: true });
    const timer = setTimeout(() => {
      compositionRef.current?.scrollIntoView({
        behavior: prefersReducedMotion ? "auto" : "smooth",
        block: "center",
      });
    }, 120);
    return () => clearTimeout(timer);
  }, [phase, prefersReducedMotion]);

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
  const done = phase === "done";

  // Reduced motion gets the finished composition with no staged entrance.
  const rise = (delay: number) =>
    prefersReducedMotion
      ? { initial: { opacity: 1, y: 0 }, animate: { opacity: 1, y: 0 } }
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.45, ease: EASE_OUT, delay },
        };

  return (
    <div ref={scope} className="relative">
      {/*
        One composition, two arrangements. While the form is up, the paper
        sits above the box. Once the note is in, the box moves to the left
        and the message comes in beside it.

        The box is a layout-animated element, so it TRAVELS between those two
        arrangements instead of cutting. That continuity is the point: the
        box the note just went into has to be recognisably the same box.
      */}
      <div
        ref={compositionRef}
        className={
          done
            ? "flex flex-col items-center gap-6 lg:flex-row lg:items-center lg:justify-center lg:gap-12"
            : "flex flex-col"
        }
      >
        {/* --- the paper, and then the message ----------------------- */}
        <div className={done ? "order-2 w-full lg:max-w-[420px]" : "order-1"}>
          {showForm && (
            <div
              ref={paperAreaRef}
              className="relative transition-[height] duration-[420ms] ease-out"
            >
              <div
                key={runId}
                data-paper
                ref={paperRef}
                className="absolute inset-x-0 top-0 z-30 mx-auto w-full max-w-2xl will-change-transform"
                style={{ perspective: 1000 }}
              >
                <div data-tilt className="will-change-transform">
                  <div data-fold className="origin-top will-change-transform">
                    <div
                      data-sheet
                      className="paper relative overflow-hidden will-change-[clip-path,height]"
                      style={{ clipPath: "inset(0% 0% 0% 0%)" }}
                    >
                      {/* --- the actual form ------------------------------ */}
                      <div data-form-body className="p-6 sm:p-9">
                        {viewerEmail === undefined ? (
                          <div aria-hidden className="animate-pulse space-y-4">
                            <div className="h-4 w-1/3 rounded bg-paper-deep" />
                            <div className="h-8 w-2/3 rounded bg-paper-deep" />
                            <div className="h-24 rounded bg-paper-deep" />
                          </div>
                        ) : viewerEmail === null ? (
                          <SignInGate />
                        ) : (
                          <SuggestionFormFields
                            form={form}
                            errors={errors}
                            formError={formError}
                            busy={busy}
                            onChange={update}
                            onSubmit={handleSubmit}
                            onToken={setTurnstileToken}
                            turnstileReset={turnstileReset}
                            viewerEmail={viewerEmail}
                          />
                        )}
                      </div>

                      {/* --- what it becomes: a sheet of paper ------------ */}
                      <div
                        data-paper-face
                        aria-hidden
                        className="pointer-events-none absolute inset-0 flex flex-col justify-between p-6 opacity-0"
                      >
                        <div>
                          <p className="eyebrow">My idea</p>
                          <p className="mt-2 line-clamp-2 font-display text-[17px] leading-snug font-semibold text-navy">
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

                      {/* --- the two creases of a letter fold ------------- */}
                      <div
                        data-crease-1
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-navy/22 opacity-0"
                      />
                      <div
                        data-crease-2
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-navy/22 opacity-0"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {done && (
            <motion.div
              ref={successCardRef}
              initial={{ opacity: prefersReducedMotion ? 1 : 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
              className="paper w-full p-6 text-center sm:p-8 lg:text-left"
            >
              <motion.h2
                ref={successRef}
                tabIndex={-1}
                {...rise(0.18)}
                className="text-[27px] leading-tight font-bold text-navy outline-none sm:text-[32px]"
              >
                Your idea is in the box!
              </motion.h2>

              <motion.p
                {...rise(0.3)}
                className="mt-3 text-[15px] leading-relaxed text-navy-soft"
              >
                It&rsquo;s waiting in the co-presidents&rsquo; private dashboard. Thanks for
                helping improve our school.
              </motion.p>

              <motion.a
                {...rise(0.4)}
                href="/my-ideas"
                className="mt-4 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12.5px] font-semibold text-emerald-900"
              >
                <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                Saved to My ideas — track its progress
              </motion.a>

              {/* The button arrives last, once there is something to leave. */}
              <motion.div {...rise(0.52)} className="mt-7">
                <button type="button" onClick={submitAnother} className="btn-primary">
                  Submit another idea
                </button>
              </motion.div>
            </motion.div>
          )}
        </div>

        {/* --- the box ------------------------------------------------- */}
        <div className={done ? "order-1 shrink-0" : "order-2"}>
          <div className={done ? "" : "mt-6 flex justify-center sm:mt-8"}>
            {/* Two layers of one drawing: the body, then the lid with the
                slot cut out of it. The note is clipped exactly on the slot's
                front lip, so it goes into the box rather than over it.

                `layout` lives on THIS element, not on a wrapper, because its
                width is the same in both arrangements. A layout animation
                interpolates size as well as position, so putting it on a
                wrapper that is full-width in one arrangement and
                shrink-to-fit in the other makes the box balloon mid-move. */}
            <motion.div
              layout
              transition={
                prefersReducedMotion
                  ? { duration: 0 }
                  : { duration: 0.55, ease: EASE_OUT }
              }
              className="relative z-20 w-[272px] sm:w-[440px]"
            >
              <div data-box className="will-change-transform">
                <SuggestionBoxArt layer="back" className="block w-full" />
                <SuggestionBoxArt
                  layer="front"
                  className="pointer-events-none absolute inset-0 block w-full"
                />
              </div>
              {/* Invisible, and the single source of truth for where the slot
                  is on screen at the current size. */}
              <span
                data-slot
                aria-hidden
                className="pointer-events-none absolute block"
                style={{
                  left: `${SLOT_BOX.left * 100}%`,
                  top: `${SLOT_BOX.top * 100}%`,
                  width: `${SLOT_BOX.width * 100}%`,
                  height: `${SLOT_BOX.height * 100}%`,
                }}
              />
            </motion.div>
          </div>

          {!done && (
            <p className="mt-5 text-center text-sm text-navy-soft">
              Every idea lands in the co-presidents&rsquo; private dashboard.
            </p>
          )}
        </div>
      </div>

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
  viewerEmail,
}: {
  form: FormState;
  errors: Record<string, string>;
  formError: string | null;
  busy: boolean;
  onChange: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onToken: (token: string | null) => void;
  turnstileReset: number;
  viewerEmail: string | null;
}) {
  return (
    <form onSubmit={onSubmit} noValidate>
      {/* honeypot — hidden from people, irresistible to bots */}
      <div aria-hidden className="absolute left-[-9999px] top-0 h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="mb-7 border-b border-rule pb-6">
        <div>
          <p className="eyebrow">Make your voice count</p>
          <h2 className="mt-2 text-[24px] leading-tight font-bold text-navy sm:text-[28px]">
            What should be better?
          </h2>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2" aria-hidden>
          {[
            ["01", "The idea"],
            ["02", "Why it matters"],
            ["03", "Your details"],
          ].map(([number, label]) => (
            <div key={number} className="border-t-2 border-navy/15 pt-2">
              <span className="mr-1.5 text-[10px] font-bold text-accent">{number}</span>
              <span className="text-[11px] font-semibold text-navy-soft sm:text-[12px]">{label}</span>
            </div>
          ))}
        </div>
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

        {/* ---- identity (required: verified name + email) ---- */}
        <div className="rounded-[12px] border border-rule bg-paper-deep/50 p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="studentName" label="Your name" error={errors.studentName}>
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
                required
              />
            </Field>
            <Field id="studentEmail" label="School email">
              <input
                id="studentEmail"
                type="email"
                value={viewerEmail ?? ""}
                readOnly
                disabled
                className="field bg-paper-deep text-navy-soft"
              />
            </Field>
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-navy-soft">
            <span className="font-semibold text-navy">Please use your actual name and school
            email.</span> Your identity is visible only to the two co-presidents.
          </p>
        </div>

        <p className="text-[13px] leading-relaxed text-navy-soft">
          <span className="font-semibold text-navy">Your privacy.</span> Suggestions go to
          the student-government co-presidents and are not posted publicly — there is no
          voting and no commenting.
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

/**
 * Shown instead of the form when nobody is signed in. Every new suggestion
 * now needs a verified school identity, so there is no anonymous fallback
 * here — signing in is the only way in.
 */
function SignInGate() {
  return (
    <div className="py-2 text-center sm:py-4">
      <p className="eyebrow">Make your voice count</p>
      <h2 className="mt-2 text-[24px] leading-tight font-bold text-navy sm:text-[28px]">
        Sign in with your school email
      </h2>
      <p className="mx-auto mt-3 max-w-sm text-[14px] leading-relaxed text-navy-soft">
        We ask every idea to carry a verified name and school email now, so the
        co-presidents know who to follow up with.{" "}
        <span className="font-semibold text-navy">
          Your identity is visible only to the two co-presidents.
        </span>
      </p>
      <a href="/my-ideas/login" className="btn-primary mt-6 inline-flex">
        Sign in to submit an idea
      </a>
    </div>
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

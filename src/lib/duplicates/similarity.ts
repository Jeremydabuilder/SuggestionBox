/**
 * Duplicate detection: how alike are two suggestions?
 *
 * Deliberately local and deterministic — no API, no model, no network, no
 * cost, and the same input always gives the same score. It compares:
 *
 *   - normalised title similarity (tokens and characters),
 *   - description and reason similarity,
 *   - how many meaningful keywords the two share,
 *   - whether they are in the same category.
 *
 * Nothing here decides anything. It returns a score and its parts; a
 * president decides what to do with them.
 *
 * ---------------------------------------------------------------------
 * Adding semantic embeddings later
 * ---------------------------------------------------------------------
 * The dashboard, the database and the API route all talk to the
 * `SimilarityStrategy` interface below, and every stored score records the
 * `method` that produced it. To add embeddings, write a second strategy
 * implementing the same interface and point `defaultStrategy` at it. Old
 * scores stay readable because each row says how it was computed, and no
 * dashboard code has to change.
 */

import { STOP_WORDS } from "./stop-words.ts";

export interface SuggestionForMatching {
  id: string;
  title: string;
  description: string;
  improvement_reason: string;
  category: string;
}

export interface SimilarityBreakdown {
  /** Overall 0-1 score, after the category weighting. */
  score: number;
  title: number;
  body: number;
  keyword: number;
  sameCategory: boolean;
  /** The meaningful words the two suggestions have in common. */
  sharedKeywords: string[];
}

export interface SimilarityStrategy {
  readonly method: string;
  compare(a: SuggestionForMatching, b: SuggestionForMatching): SimilarityBreakdown;
}

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

/**
 * At or above this, a pair is worth showing a president. Chosen so that
 * re-wordings of the same idea surface while two suggestions that merely
 * share a topic do not. The tests pin the cases it was chosen against.
 */
export const DUPLICATE_THRESHOLD = 0.62;

export const STRONG_THRESHOLD = 0.78;
export const MODERATE_THRESHOLD = 0.7;

/**
 * A category mismatch is evidence against, not proof against — the same
 * idea does get filed under two categories. So it scales the score rather
 * than vetoing the pair. At 0.75 two suggestions have to be close to
 * word-identical to match across categories.
 */
const CROSS_CATEGORY_FACTOR = 0.75;

const WEIGHT_TITLE = 0.5;
const WEIGHT_BODY = 0.3;
const WEIGHT_KEYWORD = 0.2;

/** Below this much real overlap, the pair is not scored at all. */
const MIN_SHARED_KEYWORDS = 2;
const MIN_SHARED_WITHOUT_TITLE_OVERLAP = 4;

export type SimilarityLevel = "strong" | "moderate" | "possible";

export function similarityLevel(score: number): SimilarityLevel {
  if (score >= STRONG_THRESHOLD) return "strong";
  if (score >= MODERATE_THRESHOLD) return "moderate";
  return "possible";
}

export const LEVEL_LABEL: Record<SimilarityLevel, string> = {
  strong: "Strong match",
  moderate: "Likely match",
  possible: "Possible match",
};

/* ------------------------------------------------------------------ */
/* Text handling                                                       */
/* ------------------------------------------------------------------ */

/** Lowercase, strip accents and punctuation, collapse whitespace. */
export function normalize(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A very light stem — enough to tie "period"/"periods" and "bin"/"bins"
 * together without pulling in a stemming library.
 */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (
    word.length > 4 &&
    (word.endsWith("ses") || word.endsWith("ches") || word.endsWith("shes"))
  ) {
    return word.slice(0, -2);
  }
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  return word;
}

/**
 * Meaningful words, indexed two ways.
 *
 * Matching runs on stems, so "period" and "periods" are the same word. But
 * a stem is often not a word — "recycling" stems to "recycl" — and shared
 * keywords are shown to presidents in the dashboard. So each stem also
 * keeps the shortest form actually written, and that is what gets
 * displayed.
 */
interface KeywordIndex {
  /** Stems, for comparison. */
  stems: Set<string>;
  /** stem -> the word as a student actually wrote it. */
  display: Map<string, string>;
}

function indexKeywords(input: string): KeywordIndex {
  const stems = new Set<string>();
  const display = new Map<string, string>();
  for (const raw of normalize(input).split(" ")) {
    if (!raw || raw.length < 2) continue;
    if (STOP_WORDS.has(raw)) continue;
    const stemmed = stem(raw);
    if (STOP_WORDS.has(stemmed)) continue;
    stems.add(stemmed);
    const seen = display.get(stemmed);
    if (!seen || raw.length < seen.length) display.set(stemmed, raw);
  }
  return { stems, display };
}

/** The meaningful words in a piece of text, as they were written. */
export function keywords(input: string): string[] {
  const { stems, display } = indexKeywords(input);
  return [...stems].map((s) => display.get(s) ?? s);
}

/** Dice coefficient over two sets: 2 * |A and B| / (|A| + |B|). */
function diceSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const value of a) if (b.has(value)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function bigrams(value: string): Set<string> {
  const compact = value.replace(/\s/g, "");
  const out = new Set<string>();
  for (let i = 0; i < compact.length - 1; i += 1) out.add(compact.slice(i, i + 2));
  return out;
}

/**
 * Character-level similarity. This is what makes capitalisation, spacing
 * and punctuation differences irrelevant, and what catches a typo that
 * token comparison alone would miss.
 */
function characterSimilarity(a: string, b: string): number {
  return diceSets(bigrams(normalize(a)), bigrams(normalize(b)));
}

function intersection(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const value of a) if (b.has(value)) out.push(value);
  return out;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/* ------------------------------------------------------------------ */
/* The lexical strategy                                                */
/* ------------------------------------------------------------------ */

export const lexicalStrategy: SimilarityStrategy = {
  method: "lexical-v1",

  compare(a, b) {
    const sameCategory = a.category === b.category;

    const indexTitleA = indexKeywords(a.title);
    const indexTitleB = indexKeywords(b.title);
    const indexBodyA = indexKeywords(`${a.description} ${a.improvement_reason}`);
    const indexBodyB = indexKeywords(`${b.description} ${b.improvement_reason}`);

    const titleA = indexTitleA.stems;
    const titleB = indexTitleB.stems;
    const bodyA = indexBodyA.stems;
    const bodyB = indexBodyB.stems;

    const allA = new Set([...titleA, ...bodyA]);
    const allB = new Set([...titleB, ...bodyB]);

    const shown = new Map([
      ...indexBodyB.display,
      ...indexBodyA.display,
      ...indexTitleB.display,
      ...indexTitleA.display,
    ]);
    const sharedStems = intersection(allA, allB);
    const sharedKeywords = sharedStems.map((k) => shown.get(k) ?? k).sort();
    const sharedTitle = intersection(titleA, titleB);

    // The guard that stops common words manufacturing matches: a pair needs
    // real overlap, and overlap that is only incidental words buried in two
    // long descriptions has to be substantial before it counts at all.
    const enoughOverlap =
      sharedKeywords.length >= MIN_SHARED_KEYWORDS &&
      (sharedTitle.length >= 1 || sharedKeywords.length >= MIN_SHARED_WITHOUT_TITLE_OVERLAP);

    if (!enoughOverlap) {
      return { score: 0, title: 0, body: 0, keyword: 0, sameCategory, sharedKeywords };
    }

    // Titles: tokens carry the meaning, characters catch the near-misses.
    const title = 0.65 * diceSets(titleA, titleB) + 0.35 * characterSimilarity(a.title, b.title);

    // Bodies: tokens only. Character bigrams over long prose drift upwards
    // for any two English paragraphs, so they would only add noise here.
    const body = diceSets(bodyA, bodyB);

    const keyword = Math.min(
      1,
      sharedStems.length / Math.max(2, Math.min(allA.size, allB.size)),
    );

    const base = WEIGHT_TITLE * title + WEIGHT_BODY * body + WEIGHT_KEYWORD * keyword;
    const score = sameCategory ? base : base * CROSS_CATEGORY_FACTOR;

    return {
      score: round(Math.min(1, score)),
      title: round(title),
      body: round(body),
      keyword: round(keyword),
      sameCategory,
      sharedKeywords,
    };
  },
};

/** Swap this to change how the whole application scores duplicates. */
export const defaultStrategy: SimilarityStrategy = lexicalStrategy;

export interface ScoredMatch {
  other: SuggestionForMatching;
  breakdown: SimilarityBreakdown;
}

/**
 * Score one suggestion against a set of candidates and keep the pairs worth
 * a president's attention. Never mutates anything and never decides
 * anything — it ranks, and that is all.
 */
export function findMatches(
  subject: SuggestionForMatching,
  candidates: readonly SuggestionForMatching[],
  strategy: SimilarityStrategy = defaultStrategy,
  threshold: number = DUPLICATE_THRESHOLD,
): ScoredMatch[] {
  const out: ScoredMatch[] = [];
  for (const candidate of candidates) {
    if (candidate.id === subject.id) continue;
    const breakdown = strategy.compare(subject, candidate);
    if (breakdown.score >= threshold) out.push({ other: candidate, breakdown });
  }
  return out.sort((x, y) => y.breakdown.score - x.breakdown.score);
}

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DUPLICATE_THRESHOLD,
  findMatches,
  keywords,
  lexicalStrategy,
  normalize,
  similarityLevel,
  type SuggestionForMatching,
} from "../src/lib/duplicates/similarity.ts";

function suggestion(
  id: string,
  title: string,
  description: string,
  improvement_reason: string,
  category: string,
): SuggestionForMatching {
  return { id, title, description, improvement_reason, category };
}

const score = (a: SuggestionForMatching, b: SuggestionForMatching) =>
  lexicalStrategy.compare(a, b).score;

/* ------------------------------------------------------------------ */

describe("text handling", () => {
  test("normalising removes case, punctuation and accents", () => {
    assert.equal(normalize("Longer Lunch — Périod!!"), "longer lunch period");
  });

  test("keywords drop the words every suggestion contains", () => {
    const result = keywords(
      "Please make our school better for students — we need more time",
    );
    assert.deepEqual(result, []);
  });

  test("keywords keep the words that carry the idea, as written", () => {
    assert.deepEqual(keywords("Recycling bins in the hallways"), [
      "recycling",
      "bins",
      "hallways",
    ]);
  });

  test("keywords are matched on their stem, so plurals line up", () => {
    const singular = lexicalStrategy.compare(
      suggestion("a", "Recycling bin", "A recycling bin by the door.", "Less waste.", "community"),
      suggestion("b", "Recycling bins", "Recycling bins by the doors.", "Less waste.", "community"),
    );
    assert.ok(singular.sharedKeywords.includes("bin"), singular.sharedKeywords.join(","));
  });
});

/* ------------------------------------------------------------------ */

describe("nearly identical titles in the same category", () => {
  const a = suggestion(
    "a",
    "Longer lunch period",
    "We only get twenty minutes for lunch and the queue takes most of it.",
    "More students would actually get to eat a full meal.",
    "food",
  );
  const b = suggestion(
    "b",
    "Longer lunch periods",
    "Lunch is only twenty minutes and most of that is spent in the queue.",
    "Students would get to finish a meal.",
    "food",
  );

  test("scores as a duplicate", () => {
    assert.ok(score(a, b) >= DUPLICATE_THRESHOLD, `score was ${score(a, b)}`);
  });

  test("scores strongly enough to be flagged as such", () => {
    assert.equal(similarityLevel(score(a, b)), "strong");
  });
});

describe("same wording, different capitalisation and punctuation", () => {
  const a = suggestion(
    "a",
    "Recycling bins in every hallway",
    "Put clearly labelled recycling bins next to every bin in the hallways.",
    "Less waste goes to landfill and it teaches a habit.",
    "community",
  );
  const b = suggestion(
    "b",
    "RECYCLING BINS IN EVERY HALLWAY!!!",
    "Put clearly-labelled recycling bins next to every bin in the hallways...",
    "Less waste goes to landfill, and it teaches a habit.",
    "community",
  );

  test("is treated as the same suggestion", () => {
    assert.ok(score(a, b) > 0.95, `score was ${score(a, b)}`);
  });
});

describe("clearly unrelated suggestions", () => {
  const a = suggestion(
    "a",
    "Longer lunch period",
    "We only get twenty minutes for lunch and the queue takes most of it.",
    "More students would get to eat a full meal.",
    "food",
  );
  const b = suggestion(
    "b",
    "Mural on the gym wall",
    "Let art students paint a mural on the blank wall outside the gym entrance.",
    "It would make the entrance feel like it belongs to us.",
    "school_spaces",
  );

  test("does not match", () => {
    assert.equal(score(a, b), 0);
  });

  test("two suggestions sharing only filler words do not match", () => {
    const x = suggestion(
      "x",
      "More school spirit",
      "We need more school spirit because students would feel better about school.",
      "Students want a better school.",
      "events",
    );
    const y = suggestion(
      "y",
      "Better school lunches",
      "Students need better school food because it would make the day better.",
      "Students want a better school.",
      "food",
    );
    assert.ok(score(x, y) < DUPLICATE_THRESHOLD, `score was ${score(x, y)}`);
  });
});

describe("similar titles in meaningfully different categories", () => {
  const a = suggestion(
    "a",
    "Pizza day every Friday",
    "Serve pizza in the cafeteria on Fridays instead of the usual rotation.",
    "It would give everyone something to look forward to at the end of the week.",
    "food",
  );
  const b = suggestion(
    "b",
    "Pizza party fundraiser",
    "Run a pizza party in the gym to raise money for the spring trip.",
    "It would raise money and be a fun evening for the whole year group.",
    "events",
  );

  test("the shared topic is not enough to call them duplicates", () => {
    assert.ok(score(a, b) < DUPLICATE_THRESHOLD, `score was ${score(a, b)}`);
  });

  test("but the same idea filed under two categories still surfaces", () => {
    const filedElsewhere = { ...a, id: "c", category: "events" };
    assert.ok(
      score(a, filedElsewhere) >= DUPLICATE_THRESHOLD,
      `score was ${score(a, filedElsewhere)}`,
    );
  });

  test("a category mismatch always lowers the score", () => {
    const same = { ...a, id: "d" };
    const different = { ...a, id: "e", category: "other" };
    assert.ok(score(a, different) < score(a, same));
  });
});

/* ------------------------------------------------------------------ */

describe("findMatches", () => {
  const subject = suggestion(
    "new",
    "Longer lunch period",
    "We only get twenty minutes for lunch and the queue takes most of it.",
    "More students would get to eat a full meal.",
    "food",
  );
  const pool = [
    suggestion(
      "dupe",
      "Longer lunch periods please",
      "Lunch is twenty minutes and the queue eats most of it.",
      "Students would get to finish their meal.",
      "food",
    ),
    suggestion(
      "unrelated",
      "Mural on the gym wall",
      "Let art students paint a mural outside the gym entrance.",
      "It would make the entrance feel like ours.",
      "school_spaces",
    ),
    subject,
  ];

  test("finds the duplicate and nothing else", () => {
    const found = findMatches(subject, pool);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.other.id, "dupe");
  });

  test("never matches a suggestion against itself", () => {
    assert.ok(!findMatches(subject, pool).some((m) => m.other.id === subject.id));
  });

  test("returns the parts of the score, not just a number", () => {
    const [match] = findMatches(subject, pool);
    assert.ok(match!.breakdown.title > 0);
    assert.ok(match!.breakdown.sharedKeywords.includes("lunch"));
    assert.equal(match!.breakdown.sameCategory, true);
  });

  test("results are ordered strongest first", () => {
    const weaker = suggestion(
      "weaker",
      "Lunch queue is too long",
      "The lunch queue takes most of the lunch period.",
      "Students would get to eat.",
      "food",
    );
    const found = findMatches(subject, [...pool, weaker]);
    for (let i = 1; i < found.length; i += 1) {
      assert.ok(found[i - 1]!.breakdown.score >= found[i]!.breakdown.score);
    }
  });

  test("scoring is pure — it does not touch its inputs", () => {
    const before = JSON.stringify(pool);
    findMatches(subject, pool);
    assert.equal(JSON.stringify(pool), before);
  });
});

/**
 * Words that carry no signal when comparing two school suggestions.
 *
 * Two groups:
 *   - ordinary English function words, and
 *   - words that are near-universal *in this corpus specifically*. Almost
 *     every suggestion says "school", "students" and "better", so those
 *     words say nothing about whether two suggestions are the same idea.
 *     Leaving them in is exactly what produces confident nonsense matches.
 */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  // function words
  "a", "about", "above", "after", "again", "all", "also", "am", "an", "and",
  "any", "are", "around", "as", "at", "be", "because", "been", "before",
  "being", "between", "both", "but", "by", "can", "could", "did", "do",
  "does", "doing", "done", "down", "during", "each", "even", "every", "few",
  "for", "from", "get", "gets", "getting", "had", "has", "have", "having",
  "he", "her", "here", "hers", "him", "his", "how", "i", "if", "in", "into",
  "is", "it", "its", "just", "like", "many", "may", "me", "might", "much",
  "must", "my", "no", "nor", "not", "of", "off", "on", "once", "one", "only",
  "or", "other", "our", "ours", "out", "over", "own", "put", "same", "she",
  "should", "so", "some", "such", "than", "that", "the", "their", "them",
  "then", "there", "these", "they", "thing", "things", "this", "those",
  "through", "to", "too", "under", "until", "up", "us", "use", "used",
  "very", "was", "we", "well", "were", "what", "when", "where", "which",
  "while", "who", "whom", "why", "will", "with", "would", "you", "your",
  "yours",

  // near-universal in this corpus — the ones the brief calls out
  "school", "schools", "student", "students", "better", "best", "more",
  "please", "suggestion", "suggestions", "suggest", "idea", "ideas",
  "improve", "improvement", "kid", "kids", "people", "everyone", "everybody",
  "somebody", "someone", "something", "anything", "nothing", "lot", "lots",
  "really", "maybe", "think", "thought", "want", "wants", "need", "needs",
  "make", "makes", "making", "made", "help", "helps", "helping", "good",
  "great", "nice", "new", "old", "big", "small", "day", "days", "time",
  "times", "year", "years", "way", "ways", "place", "places", "go", "going",
  "come", "coming", "see", "look", "take", "give", "add", "adding", "let",
  "lets", "class", "classes", "campus",
]);

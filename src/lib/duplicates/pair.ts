/**
 * A relationship between two suggestions is one row, whichever order the
 * two arrived in. Both the database (a check constraint) and the writer
 * agree on the same rule: the lower id goes first.
 */
export function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function pairKey(a: string, b: string): string {
  const [low, high] = canonicalPair(a, b);
  return `${low}:${high}`;
}

// Development-only: the record every rule check files a breach in.
export function makeViolation(kind, detail, seed, round) {
  return { kind, detail, seed, round };
}

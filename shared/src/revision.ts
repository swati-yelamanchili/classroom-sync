/**
 * The convergence rule on every client: keep whichever snapshot has the higher revision.
 * Duplicates and late-arriving older events therefore can never revert the display.
 */
export function newerSnapshot<T extends { revision: number }>(current: T | null, incoming: T): T {
  if (current === null) return incoming;
  return incoming.revision > current.revision ? incoming : current;
}

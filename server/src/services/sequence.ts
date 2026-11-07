import { normalizeTitle } from './matching';

export interface SequenceItem {
  /** Position the teacher entered it at. */
  enteredPosition: number;
  displayTitle: string;
  resource: {
    title: string;
    topic: string | null;
    subject: string | null;
    curriculumOrder: number | null;
    prerequisites: string[];
  } | null;
}

export interface SequencedItem<T> {
  item: T;
  note: string | null;
}

/**
 * Suggests an order using only what the library explicitly states:
 *  1. Teacher's entered order is the baseline and the tie-breaker.
 *  2. Explicit prerequisites, when the prerequisite is also in this lesson.
 *  3. curriculumOrder between resources of the same subject.
 *  4. Topics without any resource move after those with one.
 * No dependency is ever inferred. Contradictory metadata falls back to the teacher's order.
 */
export function suggestSequence<T extends SequenceItem>(items: readonly T[]): { items: SequencedItem<T>[]; notices: string[] } {
  const entered = [...items].sort((a, b) => a.enteredPosition - b.enteredPosition);
  const available = entered.filter((i) => i.resource);
  const unavailable = entered.filter((i) => !i.resource);
  const notices: string[] = [];

  // edges[a] holds every item that must come after a, with why.
  const edges = new Map<T, { after: T; reason: string }[]>(available.map((i) => [i, []]));
  for (const item of available) {
    for (const prerequisite of item.resource!.prerequisites) {
      const wanted = normalizeTitle(prerequisite);
      const source = available.find(
        (other) =>
          other !== item &&
          (normalizeTitle(other.resource!.title) === wanted ||
            (other.resource!.topic !== null && normalizeTitle(other.resource!.topic) === wanted)),
      );
      if (source) edges.get(source)!.push({ after: item, reason: `"${source.displayTitle}" is a listed prerequisite.` });
    }
  }
  const bySubject = new Map<string, T[]>();
  for (const item of available) {
    if (item.resource!.curriculumOrder === null || !item.resource!.subject) continue;
    const key = normalizeTitle(item.resource!.subject);
    bySubject.set(key, [...(bySubject.get(key) ?? []), item]);
  }
  for (const group of bySubject.values()) {
    const ordered = [...group].sort((a, b) => a.resource!.curriculumOrder! - b.resource!.curriculumOrder!);
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const [first, second] = [ordered[i]!, ordered[i + 1]!];
      if (first.resource!.curriculumOrder !== second.resource!.curriculumOrder) {
        edges.get(first)!.push({ after: second, reason: 'Follows the curriculum order in the library.' });
      }
    }
  }

  // Kahn's algorithm, always taking the earliest-entered item that is ready.
  const incoming = new Map<T, number>(available.map((i) => [i, 0]));
  for (const list of edges.values()) for (const { after } of list) incoming.set(after, incoming.get(after)! + 1);
  const ordered: T[] = [];
  const remaining = new Set(available);
  while (remaining.size) {
    const next = [...remaining].find((i) => incoming.get(i) === 0);
    if (!next) break;
    remaining.delete(next);
    ordered.push(next);
    for (const { after } of edges.get(next)!) incoming.set(after, incoming.get(after)! - 1);
  }

  const notes = new Map<T, string>();
  let resultAvailable = ordered;
  if (remaining.size) {
    resultAvailable = available;
    notices.push('The prerequisite and curriculum metadata contradict each other, so your entered order was kept.');
  } else {
    available.forEach((item, enteredIndex) => {
      if (ordered.indexOf(item) === enteredIndex) return;
      for (const [source, list] of edges) {
        const edge = list.find((e) => e.after === item);
        if (edge && item.enteredPosition < source.enteredPosition) {
          notes.set(item, `Moved: ${edge.reason}`);
          return;
        }
      }
    });
  }
  for (const item of unavailable) {
    if (entered.indexOf(item) < entered.length - unavailable.length) {
      notes.set(item, 'Moved to the end: no resource is available for this topic yet.');
    }
  }

  return {
    items: [...resultAvailable, ...unavailable].map((item) => ({ item, note: notes.get(item) ?? null })),
    notices,
  };
}

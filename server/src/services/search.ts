import { languageName, type Provenance, type ResourceDTO } from '@classroom/shared';
import { normalizeTitle } from './matching';

// Dropped from multi-word queries so "rules for traffic" still finds "Traffic Rules".
const STOPWORDS = new Set(['a', 'an', 'and', 'about', 'for', 'in', 'of', 'on', 'the', 'to', 'with']);
const PROVENANCE_RANK: Record<Provenance, number> = { verified: 0, unverified: 1, demo: 2 };

interface Field {
  weight: number;
  words: string[];
}

/** Lower weight = more important. A word found in the title beats one found in the description. */
function fieldsOf(r: ResourceDTO): Field[] {
  const field = (weight: number, values: (string | null | undefined)[]): Field => ({
    weight,
    words: values.flatMap((value) => (value ? normalizeTitle(value).split(' ') : [])).filter(Boolean),
  });
  return [
    field(0, [r.title]),
    field(1, [r.topic, ...r.aliases]),
    field(2, [r.subject, r.gradeLevel, languageName(r.language), ...r.keywords]),
    field(4, [r.description, r.sourceReference]),
  ];
}

/** Levenshtein distance, giving up once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length]!;
}

// Numbers are never "nearly" equal: grade 4 is not grade 5, and 1763112 is not 1763113.
const allowedEdits = (token: string) => (/\d/.test(token) ? 0 : token.length >= 8 ? 2 : token.length >= 4 ? 1 : 0);

/** Best (lowest) cost of one query word against a resource, or null if it is not there at all. */
function tokenCost(token: string, fields: Field[]): number | null {
  const maxEdits = allowedEdits(token);
  let best: number | null = null;
  for (const { weight, words } of fields) {
    if (best !== null && best <= weight) break;
    for (const word of words) {
      let cost: number | null = null;
      if (word === token) cost = weight;
      else if (word.startsWith(token)) cost = weight + 0.5;
      else if (maxEdits) {
        // Typos in a whole word ("managment") or in the start of one ("multiplcat").
        const edits = Math.min(editDistance(token, word, maxEdits), editDistance(token, word.slice(0, token.length), maxEdits));
        if (edits <= maxEdits) cost = weight + 2 + edits;
      }
      if (cost !== null && (best === null || cost < best)) best = cost;
    }
  }
  return best;
}

/**
 * Ranked, typo-tolerant search. Every query word must appear somewhere (title, topic, aliases,
 * subject, grade, language name, keywords or description), in any order, as a whole word, the start
 * of a word, or within one or two typos. Best matches first: an exact title, then a title starting
 * with the query, then by where and how well each word matched.
 */
export function searchResources(resources: ResourceDTO[], query: string): ResourceDTO[] {
  const phrase = normalizeTitle(query);
  if (!phrase) return resources;
  const words = phrase.split(' ');
  const tokens = words.filter((word) => !STOPWORDS.has(word));
  const used = tokens.length ? tokens : words;

  const scored: { resource: ResourceDTO; score: number }[] = [];
  for (const resource of resources) {
    const fields = fieldsOf(resource);
    let score = 0;
    let matched = true;
    for (const token of used) {
      const cost = tokenCost(token, fields);
      if (cost === null) {
        matched = false;
        break;
      }
      score += cost;
    }
    if (!matched) continue;
    const title = normalizeTitle(resource.title);
    if (title === phrase) score -= 100;
    else if (title.startsWith(phrase)) score -= 30;
    else if (title.includes(phrase)) score -= 15;
    scored.push({ resource, score });
  }
  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        PROVENANCE_RANK[a.resource.provenance] - PROVENANCE_RANK[b.resource.provenance] ||
        a.resource.title.localeCompare(b.resource.title),
    )
    .map(({ resource }) => resource);
}

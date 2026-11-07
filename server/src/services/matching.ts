import Fuse from 'fuse.js';
import type { MatchStatus, Provenance } from '@classroom/shared';

/** The subset of a resource the matcher reads. Matching can only ever return one of these. */
export interface MatchableResource {
  id: string;
  title: string;
  topic: string | null;
  aliases: string[];
  keywords: string[];
  provenance: Provenance;
  curriculumOrder: number | null;
}

export interface MatchResult<R extends MatchableResource = MatchableResource> {
  resource: R | null;
  status: MatchStatus;
  confidence: number | null;
  explanation: string;
  /** Other resources that matched equally well; a real choice, surfaced to the teacher. */
  equallyGood: R[];
}

export const NO_MATCH_MESSAGE = 'No matching resource found in the current library.';

export function normalizeTitle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const PROVENANCE_RANK: Record<Provenance, number> = { verified: 0, unverified: 1, demo: 2 };

/** Deterministic tie-break: most trustworthy provenance, then curriculum order, then title, then id. */
function byPreference(a: MatchableResource, b: MatchableResource): number {
  return (
    PROVENANCE_RANK[a.provenance] - PROVENANCE_RANK[b.provenance] ||
    (a.curriculumOrder ?? Number.MAX_SAFE_INTEGER) - (b.curriculumOrder ?? Number.MAX_SAFE_INTEGER) ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}

const FUZZY_THRESHOLD = 0.3;
/** Fuse will happily match a short word inside a long title; require the query to span most of it. */
const MIN_FUZZY_COVERAGE = 0.6;
const MIN_FUZZY_QUERY_LENGTH = 4;

function picked<R extends MatchableResource>(
  candidates: R[],
  status: MatchStatus,
  confidence: number,
  explanation: string,
): MatchResult<R> {
  const [resource, ...equallyGood] = [...candidates].sort(byPreference);
  return { resource: resource!, status, confidence, explanation, equallyGood };
}

/**
 * Priority: exact title/topic, normalised title/topic, alias or keyword, then conservative similarity.
 * Returns a resource only if it exists in `resources`, and no resource at all rather than a poor one.
 */
export function matchTopic<R extends MatchableResource>(requested: string, resources: readonly R[]): MatchResult<R> {
  const raw = requested.trim();
  const normalized = normalizeTitle(raw);
  const none: MatchResult<R> = { resource: null, status: 'unresolved', confidence: null, explanation: NO_MATCH_MESSAGE, equallyGood: [] };
  if (!normalized) return none;

  const exact = resources.filter((r) => r.title.trim() === raw || r.topic?.trim() === raw);
  if (exact.length) return picked(exact, 'exact', 1, 'Exact title or topic match.');

  const sameNormalized = resources.filter(
    (r) => normalizeTitle(r.title) === normalized || (r.topic !== null && normalizeTitle(r.topic) === normalized),
  );
  if (sameNormalized.length) {
    return picked(sameNormalized, 'normalized', 0.95, 'Matches the title or topic, ignoring case and punctuation.');
  }

  const byAlias = resources.filter((r) => [...r.aliases, ...r.keywords].some((term) => normalizeTitle(term) === normalized));
  if (byAlias.length) return picked(byAlias, 'alias', 0.85, 'Matches an alias or keyword of the resource.');

  if (normalized.length < MIN_FUZZY_QUERY_LENGTH) return none;
  const documents = resources.map((resource) => ({
    resource,
    terms: [resource.title, resource.topic, ...resource.aliases].filter((t): t is string => !!t).map(normalizeTitle),
  }));
  const fuse = new Fuse(documents, {
    keys: ['terms'],
    threshold: FUZZY_THRESHOLD,
    ignoreLocation: true,
    includeScore: true,
    includeMatches: true,
  });
  for (const hit of fuse.search(normalized)) {
    const term = hit.matches?.map((m) => m.value ?? '').find((value) => value.length > 0 && normalized.length / value.length >= MIN_FUZZY_COVERAGE);
    if (term) {
      const confidence = Math.round((1 - (hit.score ?? FUZZY_THRESHOLD)) * 0.8 * 100) / 100;
      return {
        resource: hit.item.resource,
        status: 'fuzzy',
        confidence,
        explanation: `Similar to "${term}". Please check this is the resource you meant.`,
        equallyGood: [],
      };
    }
  }
  return none;
}

import { describe, expect, it } from 'vitest';
import { matchTopic, NO_MATCH_MESSAGE, type MatchableResource } from '../src/services/matching';
import { suggestSequence, type SequenceItem } from '../src/services/sequence';

const resource = (id: string, overrides: Partial<MatchableResource> = {}): MatchableResource => ({
  id,
  title: id,
  topic: null,
  aliases: [],
  keywords: [],
  provenance: 'unverified',
  curriculumOrder: null,
  ...overrides,
});

const library = [
  resource('r1', { title: 'Addition', aliases: ['Adding numbers'], keywords: ['plus'] }),
  resource('r2', { title: 'Subtraction video', topic: 'Subtraction' }),
  resource('r3', { title: 'Photosynthesis in plants' }),
];

describe('matchTopic', () => {
  it('matches an exact title', () => {
    expect(matchTopic('Addition', library)).toMatchObject({ resource: { id: 'r1' }, status: 'exact', confidence: 1 });
  });
  it('matches an exact topic field', () => {
    expect(matchTopic('Subtraction', library)).toMatchObject({ resource: { id: 'r2' }, status: 'exact' });
  });
  it('is case-insensitive through normalisation', () => {
    expect(matchTopic('ADDITION', library)).toMatchObject({ resource: { id: 'r1' }, status: 'normalized' });
    expect(matchTopic('  addition!! ', library)).toMatchObject({ resource: { id: 'r1' }, status: 'normalized' });
  });
  it('matches aliases and keywords', () => {
    expect(matchTopic('adding numbers', library)).toMatchObject({ resource: { id: 'r1' }, status: 'alias' });
    expect(matchTopic('Plus', library)).toMatchObject({ resource: { id: 'r1' }, status: 'alias' });
  });
  it('tolerates a typo but flags it as a lower-confidence fuzzy match', () => {
    const result = matchTopic('Additon', library);
    expect(result).toMatchObject({ resource: { id: 'r1' }, status: 'fuzzy' });
    expect(result.confidence).toBeLessThan(0.85);
  });
  it('finds a typo through the topic field when the title is long', () => {
    const long = [resource('s', { title: 'Subtraction (a long descriptive placeholder title)', topic: 'Subtraction' })];
    expect(matchTopic('Subtractoin', long)).toMatchObject({ resource: { id: 's' }, status: 'fuzzy' });
    expect(matchTopic('Sbtraction', long)).toMatchObject({ resource: { id: 's' }, status: 'fuzzy' });
  });
  it('reports no match honestly and attaches nothing', () => {
    for (const unrelated of ['Volcanoes', 'Mathematics', 'History of India', 'on', '???']) {
      const result = matchTopic(unrelated, library);
      expect(result.resource).toBeNull();
      expect(result.status).toBe('unresolved');
      expect(result.explanation).toBe(NO_MATCH_MESSAGE);
    }
  });
  it('does not attach a long title because a short word appears inside it', () => {
    expect(matchTopic('plants', library).resource).toBeNull();
  });
  it('only ever returns an object from the library', () => {
    for (const q of ['Addition', 'Additon', 'subtraction', 'adding numbers', 'random text', 'Photosynthesis']) {
      const { resource: found } = matchTopic(q, library);
      if (found) expect(library).toContain(found);
    }
  });
  it('returns nothing from an empty library', () => {
    expect(matchTopic('Addition', []).resource).toBeNull();
  });
  it('resolves duplicate titles deterministically, preferring verified, and exposes the alternatives', () => {
    const dupes = [
      resource('demo', { title: 'Addition', provenance: 'demo' }),
      resource('real', { title: 'Addition', provenance: 'verified' }),
      resource('other', { title: 'Addition', provenance: 'unverified' }),
    ];
    const first = matchTopic('Addition', dupes);
    expect(first.resource?.id).toBe('real');
    expect(first.equallyGood.map((r) => r.id).sort()).toEqual(['demo', 'other']);
    expect(matchTopic('Addition', [...dupes].reverse()).resource?.id).toBe('real');
  });
});

const item = (
  enteredPosition: number,
  displayTitle: string,
  resourceFields: Partial<NonNullable<SequenceItem['resource']>> | null = {},
): SequenceItem => ({
  enteredPosition,
  displayTitle,
  resource:
    resourceFields === null
      ? null
      : { title: displayTitle, topic: null, subject: null, curriculumOrder: null, prerequisites: [], ...resourceFields },
});

const titles = (result: { items: { item: SequenceItem }[] }) => result.items.map((i) => i.item.displayTitle);

describe('suggestSequence', () => {
  it('preserves the entered order when the library states nothing', () => {
    const result = suggestSequence([item(0, 'Multiplication'), item(1, 'Addition'), item(2, 'Subtraction')]);
    expect(titles(result)).toEqual(['Multiplication', 'Addition', 'Subtraction']);
    expect(result.items.every((i) => i.note === null)).toBe(true);
  });
  it('honours explicit prerequisites and explains the move', () => {
    const result = suggestSequence([item(0, 'Division', { prerequisites: ['Multiplication'] }), item(1, 'Multiplication')]);
    expect(titles(result)).toEqual(['Multiplication', 'Division']);
    expect(result.items[1]!.note).toContain('prerequisite');
  });
  it('ignores a prerequisite that is not in this lesson', () => {
    const result = suggestSequence([item(0, 'Division', { prerequisites: ['Algebra'] }), item(1, 'Addition')]);
    expect(titles(result)).toEqual(['Division', 'Addition']);
  });
  it('uses curriculum order within a subject only', () => {
    const result = suggestSequence([
      item(0, 'B', { subject: 'Maths', curriculumOrder: 2 }),
      item(1, 'Other', { subject: 'Science', curriculumOrder: 1 }),
      item(2, 'A', { subject: 'Maths', curriculumOrder: 1 }),
    ]);
    expect(titles(result)).toEqual(['Other', 'A', 'B']);
  });
  it('moves topics without a resource to the end, with a reason', () => {
    const result = suggestSequence([item(0, 'Mathematics', null), item(1, 'Addition'), item(2, 'Subtraction')]);
    expect(titles(result)).toEqual(['Addition', 'Subtraction', 'Mathematics']);
    expect(result.items[2]!.note).toContain('no resource');
  });
  it('falls back to the teacher order when metadata contradicts itself', () => {
    const result = suggestSequence([
      item(0, 'A', { prerequisites: ['B'] }),
      item(1, 'B', { prerequisites: ['A'] }),
    ]);
    expect(titles(result)).toEqual(['A', 'B']);
    expect(result.notices[0]).toContain('entered order');
  });
});

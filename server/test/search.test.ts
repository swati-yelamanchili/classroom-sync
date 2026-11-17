import { describe, expect, it } from 'vitest';
import type { ResourceDTO } from '@classroom/shared';
import { editDistance, searchResources } from '../src/services/search';

let n = 0;
const resource = (title: string, extra: Partial<ResourceDTO> = {}): ResourceDTO => ({
  id: `r${(n += 1)}`,
  title,
  subject: null,
  topic: null,
  description: null,
  keywords: [],
  aliases: [],
  videoUrl: null,
  scriptText: null,
  language: null,
  gradeLevel: null,
  sourceOrganisation: null,
  sourceReference: null,
  provenance: 'verified',
  curriculumOrder: null,
  prerequisites: [],
  createdAt: '',
  updatedAt: '',
  ...extra,
});

const library = [
  resource('Traffic Rules', { subject: 'Grade 4 EVS', language: 'ta' }),
  resource('Traffic Rules', { subject: 'Grade 4 EVS', language: 'mr' }),
  resource('Waste Management', { subject: 'Grade 4 EVS', language: 'ta' }),
  resource('Perimeter – Borders and boundaries', { subject: 'Grade 4 Maths', language: 'en' }),
  resource('Fractions – Fractions on the number lines', { subject: 'Grade 5 Maths', language: 'mr' }),
  resource('Air Pollution and its Effects', { subject: 'Grade 4 EVS', language: 'ta' }),
  resource('Air', { subject: 'Grade 4 EVS', language: 'ta' }),
  resource('Multiply and divide Multiplication', { subject: 'Grade 5 Maths', language: 'ta', description: 'Times tables' }),
];
const titles = (query: string) => searchResources(library, query).map((r) => `${r.title}${r.language ? ` (${r.language})` : ''}`);

describe('searchResources', () => {
  it('finds a word at the start of a longer title', () => {
    expect(titles('Perimeter')).toEqual(['Perimeter – Borders and boundaries (en)']);
  });

  it('tolerates typos', () => {
    expect(titles('waste managment')).toEqual(['Waste Management (ta)']);
    expect(titles('multiplicaton')).toEqual(['Multiply and divide Multiplication (ta)']);
  });

  it('accepts words in any order, and ignores little words', () => {
    expect(titles('rules for traffic')).toEqual(['Traffic Rules (ta)', 'Traffic Rules (mr)']);
  });

  it('narrows by language name, grade and subject', () => {
    expect(titles('traffic rules marathi')).toEqual(['Traffic Rules (mr)']);
    expect(titles('traffic marati')).toEqual(['Traffic Rules (mr)']);
    expect(titles('grade 5 fractions')).toEqual(['Fractions – Fractions on the number lines (mr)']);
  });

  it('puts an exact title first', () => {
    expect(titles('air')).toEqual(['Air (ta)', 'Air Pollution and its Effects (ta)']);
  });

  it('searches the description, ranked below title matches', () => {
    expect(titles('tables')).toEqual(['Multiply and divide Multiplication (ta)']);
  });

  it('prefers verified resources when matches are equal', () => {
    const demo = resource('Addition', { provenance: 'demo' });
    const real = resource('Addition', { provenance: 'verified' });
    expect(searchResources([demo, real], 'addition')[0]).toBe(real);
  });

  it('never treats numbers as typos', () => {
    const items = [resource('Manual 1763112345678'), resource('Manual 1763112345679'), resource('Grade 4 only', { subject: 'Grade 4' })];
    expect(searchResources(items, 'Manual 1763112345678').map((r) => r.title)).toEqual(['Manual 1763112345678']);
    expect(searchResources(items, 'grade 5')).toEqual([]);
  });

  it('returns nothing rather than a poor match, and everything for an empty query', () => {
    expect(titles('volcanoes')).toEqual([]);
    expect(titles('xyz')).toEqual([]);
    expect(searchResources(library, '  ')).toHaveLength(library.length);
  });
});

describe('editDistance', () => {
  it.each([
    ['managment', 'management', 1],
    ['traffic', 'traffic', 0],
    ['kitten', 'sitting', 3],
  ])('%s -> %s is %i', (a, b, d) => {
    expect(editDistance(a, b, 5)).toBe(d);
  });

  it('gives up past the limit', () => {
    expect(editDistance('abcdefgh', 'zzzzzzzz', 2)).toBe(3);
  });
});

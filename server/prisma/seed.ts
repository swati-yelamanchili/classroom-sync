/**
 * Seeds a clearly labelled DEMONSTRATION dataset. None of this is Ashray Akruti content: the videos are
 * title cards, the scripts are placeholder text with no educational material, and every record has
 * provenance "demo". Re-running is safe; demo records are upserted and real resources are untouched.
 */
import { PrismaClient } from '@prisma/client';
import { dedupeKeyFor } from '../src/services/resources';

const DEMO_SOURCE = 'Demo dataset (not Ashray Akruti)';

function placeholderScript(topic: string): string {
  return [
    'DEMONSTRATION PLACEHOLDER. NOT EDUCATIONAL CONTENT.',
    '',
    `This text stands in for the existing script that will accompany the resource for "${topic}".`,
    'It contains no teaching material and was not provided by Ashray Akruti.',
    '',
    'It has several paragraphs and line breaks so that you can check',
    'the script is displayed exactly as stored.',
    '',
    'Import the real script to replace it. See RESOURCE_IMPORT.md.',
  ].join('\n');
}

interface DemoResource {
  topic: string;
  aliases: string[];
  videoUrl: string | null;
  hasScript: boolean;
  description: string;
}

const demoResources: DemoResource[] = [
  { topic: 'Addition', aliases: ['Adding', 'Adding numbers'], videoUrl: '/demo/demo-addition.mp4', hasScript: true, description: 'Local placeholder clip: exercises the embedded video player.' },
  { topic: 'Subtraction', aliases: ['Subtracting', 'Taking away'], videoUrl: '/demo/demo-subtraction.mp4', hasScript: true, description: 'Local placeholder clip: exercises the embedded video player.' },
  { topic: 'Multiplication', aliases: ['Multiplying', 'Times tables'], videoUrl: '/demo/demo-multiplication.mp4', hasScript: true, description: 'Local placeholder clip: exercises the embedded video player.' },
  { topic: 'Division', aliases: ['Dividing'], videoUrl: 'https://example.com/', hasScript: true, description: 'External page that cannot be embedded: exercises the open-in-new-tab fallback.' },
  { topic: 'Fractions', aliases: [], videoUrl: null, hasScript: true, description: 'Script only: exercises the "no video available" state.' },
];

const db = new PrismaClient();

for (const demo of demoResources) {
  const fields = {
    title: `${demo.topic} (demo placeholder)`,
    subject: 'Demo subject',
    topic: demo.topic,
    description: demo.description,
    keywords: '[]',
    aliases: JSON.stringify(demo.aliases),
    videoUrl: demo.videoUrl,
    scriptText: demo.hasScript ? placeholderScript(demo.topic) : null,
    language: null,
    gradeLevel: null,
    sourceOrganisation: DEMO_SOURCE,
    sourceReference: null,
    provenance: 'demo',
    curriculumOrder: null,
    prerequisites: '[]',
  };
  const dedupeKey = dedupeKeyFor({ title: fields.title, subject: fields.subject, language: null });
  await db.resource.upsert({ where: { dedupeKey }, create: { ...fields, dedupeKey }, update: fields });
}

const demoCount = await db.resource.count({ where: { provenance: 'demo' } });
console.info(`Seeded demo resources. ${demoCount} records in the library are labelled "demo".`);
await db.$disconnect();

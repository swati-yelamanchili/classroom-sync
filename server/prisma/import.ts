/**
 * Imports a CSV or JSON resource file with the same validation and duplicate checks as the teacher's Import page.
 * Usage from the repository root: npm run db:import -- resources/ashray-akruti-youtube.csv
 * Add --if-empty to import only into an empty library (the Docker image does this on every start).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { ResourceService } from '../src/services/resources';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run db:import -- <file.csv | file.json>');
  process.exit(1);
}
// npm runs this inside server/, so resolve the path from wherever the command was typed.
const fullPath = path.resolve(process.env.INIT_CWD ?? process.cwd(), file);
const format = fullPath.toLowerCase().endsWith('.json') ? 'json' : 'csv';

const db = new PrismaClient();
if (process.argv.includes('--if-empty') && (await db.resource.count()) > 0) {
  console.info('The library already has resources; nothing imported.');
  await db.$disconnect();
  process.exit(0);
}
const report = await new ResourceService(db).importResources(format, readFileSync(fullPath, 'utf8'), false);
await db.$disconnect();

console.info(`Imported ${report.created} of ${report.totalRows} rows from ${path.basename(fullPath)}.`);
if (report.duplicates.length) console.info(`Skipped ${report.duplicates.length} already in the library or repeated in the file.`);
for (const error of report.errors) console.error(`Row ${error.row}${error.field ? ` (${error.field})` : ''}: ${error.message}`);
if (report.errors.length) process.exitCode = 1;

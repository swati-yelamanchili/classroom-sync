import type { PrismaClient, Resource } from '@prisma/client';
import Papa from 'papaparse';
import type { ImportReport, Provenance, ResourceDTO, ResourceStats } from '@classroom/shared';
import { ApiError, conflict, notFound } from '../lib/errors';
import { normalizeTitle } from './matching';
import { resourceInputSchema, type ResourceInput } from './resourceSchema';

const parseList = (value: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

export function toResourceDTO(r: Resource): ResourceDTO {
  return {
    id: r.id,
    title: r.title,
    subject: r.subject,
    topic: r.topic,
    description: r.description,
    keywords: parseList(r.keywords),
    aliases: parseList(r.aliases),
    videoUrl: r.videoUrl,
    scriptText: r.scriptText,
    language: r.language,
    gradeLevel: r.gradeLevel,
    sourceOrganisation: r.sourceOrganisation,
    sourceReference: r.sourceReference,
    provenance: r.provenance as Provenance,
    curriculumOrder: r.curriculumOrder,
    prerequisites: parseList(r.prerequisites),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function dedupeKeyFor(input: Pick<ResourceInput, 'title' | 'subject' | 'language'>): string {
  return [input.title, input.subject ?? '', input.language ?? ''].map(normalizeTitle).join('|');
}

function toRow(input: ResourceInput) {
  return {
    ...input,
    keywords: JSON.stringify(input.keywords),
    aliases: JSON.stringify(input.aliases),
    prerequisites: JSON.stringify(input.prerequisites),
    dedupeKey: dedupeKeyFor(input),
  };
}

function parseImportRows(format: 'csv' | 'json', content: string): Record<string, unknown>[] {
  if (format === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content.replace(/^﻿/, ''));
    } catch (error) {
      throw new ApiError(400, 'invalid_file', `This is not valid JSON: ${(error as Error).message}`);
    }
    const rows = Array.isArray(parsed) ? parsed : (parsed as { resources?: unknown } | null)?.resources;
    if (!Array.isArray(rows)) {
      throw new ApiError(400, 'invalid_file', 'The JSON file must contain an array of resources, or { "resources": [...] }.');
    }
    return rows as Record<string, unknown>[];
  }
  const result = Papa.parse<Record<string, string>>(content.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  const fields = result.meta.fields ?? [];
  if (!fields.includes('title')) {
    throw new ApiError(400, 'invalid_file', 'The CSV file must have a header row that includes a "title" column.');
  }
  // An empty CSV cell means "not provided", the same as an absent JSON key.
  return result.data.map((row) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== '')));
}

export class ResourceService {
  constructor(private readonly db: PrismaClient) {}

  async list(query?: string): Promise<ResourceDTO[]> {
    const rows = await this.db.resource.findMany({ orderBy: [{ subject: 'asc' }, { title: 'asc' }] });
    const dtos = rows.map(toResourceDTO);
    const q = normalizeTitle(query ?? '');
    if (!q) return dtos;
    return dtos.filter((r) =>
      [r.title, r.topic, r.subject, r.description, ...r.aliases, ...r.keywords].some((v) => v && normalizeTitle(v).includes(q)),
    );
  }

  async stats(): Promise<ResourceStats> {
    const groups = await this.db.resource.groupBy({ by: ['provenance'], _count: { _all: true } });
    const count = (p: Provenance) => groups.find((g) => g.provenance === p)?._count._all ?? 0;
    const [demo, unverified, verified] = [count('demo'), count('unverified'), count('verified')];
    return { total: demo + unverified + verified, demo, unverified, verified };
  }

  async get(id: string): Promise<ResourceDTO> {
    const row = await this.db.resource.findUnique({ where: { id } });
    if (!row) throw notFound('Resource');
    return toResourceDTO(row);
  }

  private async findDuplicate(input: ResourceInput, ignoreId?: string): Promise<string | null> {
    const key = dedupeKeyFor(input);
    const byKey = await this.db.resource.findUnique({ where: { dedupeKey: key } });
    if (byKey && byKey.id !== ignoreId) return `A resource with the same title, subject and language already exists ("${byKey.title}").`;
    if (input.videoUrl) {
      const byUrl = await this.db.resource.findFirst({ where: { videoUrl: input.videoUrl, id: { not: ignoreId ?? '' } } });
      if (byUrl) return `Another resource already uses this video URL ("${byUrl.title}").`;
    }
    return null;
  }

  async create(input: ResourceInput): Promise<ResourceDTO> {
    const duplicate = await this.findDuplicate(input);
    if (duplicate) throw conflict('duplicate_resource', duplicate);
    return toResourceDTO(await this.db.resource.create({ data: toRow(input) }));
  }

  async update(id: string, input: ResourceInput): Promise<ResourceDTO> {
    await this.get(id);
    const duplicate = await this.findDuplicate(input, id);
    if (duplicate) throw conflict('duplicate_resource', duplicate);
    return toResourceDTO(await this.db.resource.update({ where: { id }, data: toRow(input) }));
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    const inUse = await this.db.lessonTopic.count({
      where: { resourceId: id, lesson: { sessions: { some: { status: { not: 'ended' } } } } },
    });
    if (inUse > 0) throw conflict('resource_in_use', 'This resource is part of a classroom session that has not ended.');
    await this.db.$transaction([
      this.db.lessonTopic.updateMany({
        where: { resourceId: id },
        data: { resourceId: null, matchStatus: 'unresolved', matchConfidence: null, matchExplanation: 'The attached resource was deleted from the library.' },
      }),
      this.db.resource.delete({ where: { id } }),
    ]);
  }

  /** Valid rows are imported; malformed rows and duplicates are reported rather than dropped silently. */
  async importResources(format: 'csv' | 'json', content: string, dryRun: boolean): Promise<ImportReport> {
    const rows = parseImportRows(format, content);
    const report: ImportReport = { dryRun, totalRows: rows.length, created: 0, valid: [], duplicates: [], errors: [] };
    const seenKeys = new Map<string, number>();
    const seenUrls = new Map<string, number>();
    const accepted: { row: number; input: ResourceInput }[] = [];

    rows.forEach((raw, i) => {
      // Row numbers match what the person sees in their file: CSV has a header on line 1.
      const row = format === 'csv' ? i + 2 : i + 1;
      const parsed = resourceInputSchema.safeParse(raw);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          report.errors.push({ row, field: issue.path.join('.') || undefined, message: issue.message });
        }
        return;
      }
      accepted.push({ row, input: parsed.data });
    });

    for (const { row, input } of accepted) {
      const key = dedupeKeyFor(input);
      const firstRow = seenKeys.get(key) ?? (input.videoUrl ? seenUrls.get(input.videoUrl) : undefined);
      if (firstRow !== undefined) {
        report.duplicates.push({ row, title: input.title, reason: `Duplicate of row ${firstRow} in this file.` });
        continue;
      }
      const existing = await this.findDuplicate(input);
      if (existing) {
        report.duplicates.push({ row, title: input.title, reason: existing });
        continue;
      }
      seenKeys.set(key, row);
      if (input.videoUrl) seenUrls.set(input.videoUrl, row);
      report.valid.push({ row, title: input.title });
      if (!dryRun) {
        await this.db.resource.create({ data: toRow(input) });
        report.created += 1;
      }
    }
    return report;
  }
}

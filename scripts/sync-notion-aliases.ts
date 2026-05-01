/**
 * Notion → Exercise Aliases + Measurement Type Sync Script
 *
 * Fetches the Aliases and Measurement Type properties from the Notion Exercise Database
 * and updates src/data/exercises.ts with alias arrays and measurementType values.
 *
 * Usage:
 *   npx tsx scripts/sync-notion-aliases.ts
 *
 * Requires:
 *   - NOTION_API_KEY environment variable
 *   - Notion database ID: bdb933b6a3564263a266478ed54bcb77
 */

import * as fs from 'fs';
import * as path from 'path';

const NOTION_DATABASE_ID = 'bdb933b6a3564263a266478ed54bcb77';
const EXERCISES_FILE = path.resolve(__dirname, '../src/data/exercises.ts');

interface NotionPage {
  properties: {
    Exercise: { title: Array<{ plain_text: string }> };
    Aliases: { rich_text: Array<{ plain_text: string }> };
    'Measurement Type': { select: { name: string } | null };
  };
}

function normalizeSearch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().replace(/s$/, '');
}

async function fetchAllPages(apiKey: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const res = await fetch(
      `https://api.notion.com/v1/databases/${NOTION_DATABASE_ID}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      throw new Error(`Notion API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    pages.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return pages;
}

async function main() {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    console.error('Missing NOTION_API_KEY environment variable');
    process.exit(1);
  }

  console.log('Fetching exercises from Notion...');
  const pages = await fetchAllPages(apiKey);
  console.log(`Fetched ${pages.length} exercises`);

  // Build alias map and measurement type map
  const aliasMap = new Map<string, string[]>();
  const measurementTypeMap = new Map<string, string>();
  const canonicalNames = new Set<string>();

  // First pass: collect all canonical names
  for (const page of pages) {
    const name = page.properties.Exercise?.title?.[0]?.plain_text;
    if (name) canonicalNames.add(normalizeSearch(name));
  }

  // Second pass: parse aliases and measurement types
  let skipped = 0;
  for (const page of pages) {
    const name = page.properties.Exercise?.title?.[0]?.plain_text;
    if (!name) continue;

    // Aliases
    const aliasRaw = page.properties.Aliases?.rich_text
      ?.map((t: { plain_text: string }) => t.plain_text)
      .join('') || '';

    if (aliasRaw.trim()) {
      const aliases = aliasRaw
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);

      const valid = aliases.filter(alias => {
        const norm = normalizeSearch(alias);
        if (canonicalNames.has(norm)) {
          console.warn(`⚠ Skipping alias "${alias}" for "${name}" — collides with canonical name`);
          skipped++;
          return false;
        }
        return true;
      });

      if (valid.length > 0) {
        aliasMap.set(name, valid);
      }
    }

    // Measurement Type
    const mt = page.properties['Measurement Type']?.select?.name;
    if (mt) {
      measurementTypeMap.set(name, mt);
    }
  }

  console.log(`Parsed aliases for ${aliasMap.size} exercises (${skipped} aliases skipped due to collisions)`);
  console.log(`Parsed measurement types for ${measurementTypeMap.size} exercises`);

  // Read and update exercises.ts
  let source = fs.readFileSync(EXERCISES_FILE, 'utf-8');

  // Inject aliases
  for (const [name, aliases] of aliasMap) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `(name: '${escapedName}'.*?secondaryMuscles: \\[[^\\]]*\\])`,
      's'
    );

    const aliasStr = aliases.map(a => `'${a.replace(/'/g, "\\'")}'`).join(', ');
    const replacement = `$1, aliases: [${aliasStr}]`;

    if (pattern.test(source)) {
      source = source.replace(pattern, replacement);
    } else {
      console.warn(`Could not find exercise "${name}" in exercises.ts for aliases`);
    }
  }

  // Inject measurement types
  for (const [name, mt] of measurementTypeMap) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Match the exercise line up to the closing }, accounting for aliases and existing measurementType
    const pattern = new RegExp(
      `(name: '${escapedName}'.*?secondaryMuscles: \\[[^\\]]*\\](?:, aliases: \\[[^\\]]*\\])?)(?:, measurementType: '[^']*')?`,
      's'
    );

    const replacement = `$1, measurementType: '${mt}'`;

    if (pattern.test(source)) {
      source = source.replace(pattern, replacement);
    } else {
      console.warn(`Could not find exercise "${name}" in exercises.ts for measurementType`);
    }
  }

  fs.writeFileSync(EXERCISES_FILE, source);
  console.log('✅ Updated exercises.ts with aliases and measurement types');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

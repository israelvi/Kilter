import { promises as fs } from 'node:fs';
import type { ArtifactRecord, EntityType, ParsedArtifact, ParsedEntity } from '../../models/types';
import type { ArtifactParser, ParserMatch } from './types';

const SQLITE_MAGIC = 'SQLite format 3\u0000';

/**
 * Inspects a SQLite database, lists tables, samples a few rows from each,
 * and applies a coarse name-based heuristic to classify likely entity
 * tables (users, problems, ascents, board layouts).
 *
 * Uses better-sqlite3 in read-only mode.
 */
export const SqliteParser: ArtifactParser = {
  id: 'sqlite',
  async probe(_file, head) {
    if (head.length >= SQLITE_MAGIC.length && head.slice(0, SQLITE_MAGIC.length).toString('binary') === SQLITE_MAGIC) {
      return { parserId: 'sqlite', specificity: 100 };
    }
    return null;
  },
  async parse(file): Promise<ParsedArtifact> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const entities: ParsedEntity[] = [];
    let summary = 'sqlite';

    try {
      // better-sqlite3 is a CommonJS native module; require lazily so the
      // app still loads if the binary failed to compile on the user's
      // machine. We surface the install hint in the warning instead.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3');
      const db = new Database(file.hostPath, { readonly: true, fileMustExist: true });
      try {
        const tables = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
          .all() as Array<{ name: string }>;
        summary = `sqlite db, ${tables.length} table(s): ${tables.map((t) => t.name).join(', ')}`;

        for (const t of tables) {
          let rows: unknown[] = [];
          try {
            rows = db.prepare(`SELECT * FROM "${t.name.replace(/"/g, '""')}" LIMIT 5`).all();
          } catch (err) {
            warnings.push(`could not sample table ${t.name}: ${(err as Error).message}`);
          }
          const cols = rows.length > 0 ? Object.keys(rows[0] as Record<string, unknown>) : [];
          entities.push({
            type: classifyTable(t.name),
            confidence: classifyTable(t.name) === 'unknown' ? 'low' : 'medium',
            data: {
              table: t.name,
              columnCount: cols.length,
              columns: cols,
              sampleRows: rows
            }
          });
        }
      } finally {
        db.close();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`sqlite parse failed: ${msg}`);
      if (/MODULE_NOT_FOUND|better-sqlite3/.test(msg)) {
        warnings.push('better-sqlite3 may need to be rebuilt for the current Electron ABI (run `npm rebuild better-sqlite3`)');
      }
    }

    return {
      artifactId: file.id,
      parserId: 'sqlite',
      parsedAt: new Date().toISOString(),
      summary,
      entities,
      warnings,
      errors
    };
  }
};

function classifyTable(name: string): EntityType {
  const n = name.toLowerCase();
  if (/(^|_)user|account|profile/.test(n)) return 'user.profile';
  if (/(problem|climb|route|boulder)/.test(n)) return 'climb.problem';
  if (/(ascent|send|tick|log)/.test(n)) return 'climb.ascent';
  if (/(attempt|try)/.test(n)) return 'climb.attempt';
  if (/(layout|board|hold|set|kit)/.test(n)) return 'board.layout';
  if (/(setting|config|pref)/.test(n)) return 'config';
  if (/(sync|migration|version)/.test(n)) return 'sync.metadata';
  if (/(cache|response)/.test(n)) return 'cache.api';
  return 'unknown';
}

/** Helper used by the registry to read a head buffer cheaply. */
export async function readHead(path: string, n = 32): Promise<Buffer> {
  const fh = await fs.open(path, 'r');
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.slice(0, bytesRead);
  } finally {
    await fh.close();
  }
}

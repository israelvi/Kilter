import { promises as fs } from 'node:fs';
import type { ArtifactRecord, ParsedArtifact, ParsedEntity } from '../../models/types';
import type { ArtifactParser } from './types';

const MAX_BYTES = 8 * 1024 * 1024; // refuse to load JSON over 8 MB into memory

export const JsonParser: ArtifactParser = {
  id: 'json',
  async probe(file, head) {
    if (file.fileName.toLowerCase().endsWith('.json')) return { parserId: 'json', specificity: 80 };
    const trimmed = head.toString('utf8').trimStart();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return { parserId: 'json', specificity: 50 };
    return null;
  },
  async parse(file): Promise<ParsedArtifact> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const entities: ParsedEntity[] = [];
    let summary = 'json';

    try {
      const stat = await fs.stat(file.hostPath);
      if (stat.size > MAX_BYTES) {
        warnings.push(`json too large to load fully (${stat.size} bytes); summarising structure only`);
        summary = `json (${stat.size} bytes, not loaded)`;
      } else {
        const text = await fs.readFile(file.hostPath, 'utf8');
        const parsed = JSON.parse(text) as unknown;
        const { kind, count, topKeys } = describeJson(parsed);
        summary = `json (${kind}${count != null ? `, ${count} entries` : ''}${topKeys.length ? `, top keys: ${topKeys.slice(0, 8).join(', ')}` : ''})`;
        entities.push({
          type: 'unknown',
          confidence: 'low',
          data: {
            kind,
            count,
            topKeys,
            preview: previewValue(parsed)
          }
        });
      }
    } catch (err) {
      errors.push(`json parse failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      artifactId: file.id,
      parserId: 'json',
      parsedAt: new Date().toISOString(),
      summary,
      entities,
      warnings,
      errors
    };
  }
};

function describeJson(v: unknown): { kind: string; count: number | null; topKeys: string[] } {
  if (Array.isArray(v)) return { kind: 'array', count: v.length, topKeys: [] };
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>);
    return { kind: 'object', count: keys.length, topKeys: keys };
  }
  return { kind: typeof v, count: null, topKeys: [] };
}

function previewValue(v: unknown, depth = 0): unknown {
  if (depth > 2) return '[…]';
  if (Array.isArray(v)) return v.slice(0, 3).map((x) => previewValue(x, depth + 1));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    let i = 0;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (i++ >= 8) break;
      out[k] = previewValue(val, depth + 1);
    }
    return out;
  }
  return v;
}

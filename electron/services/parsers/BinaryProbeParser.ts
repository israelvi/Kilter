import { promises as fs } from 'node:fs';
import type { ArtifactRecord, ParsedArtifact } from '../../models/types';
import type { ArtifactParser } from './types';

/**
 * Catch-all parser. Records size, magic bytes, and a tiny printable
 * preview. Always matches with the lowest specificity so it only runs
 * when no other parser claims the file.
 */
export const BinaryProbeParser: ArtifactParser = {
  id: 'binary',
  async probe() {
    return { parserId: 'binary', specificity: 1 };
  },
  async parse(file): Promise<ParsedArtifact> {
    const warnings: string[] = [];
    const errors: string[] = [];
    let summary = 'binary';
    let magic: string | null = null;
    let size = 0;
    let preview = '';

    try {
      const stat = await fs.stat(file.hostPath);
      size = stat.size;
      const fh = await fs.open(file.hostPath, 'r');
      try {
        const buf = Buffer.alloc(Math.min(64, stat.size));
        await fh.read(buf, 0, buf.length, 0);
        magic = identifyMagic(buf);
        preview = buf.toString('binary').replace(/[^\x20-\x7e]/g, '.');
      } finally {
        await fh.close();
      }
      summary = `binary (${size} bytes, magic=${magic ?? 'unknown'})`;
    } catch (err) {
      errors.push(`binary probe failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      artifactId: file.id,
      parserId: 'binary',
      parsedAt: new Date().toISOString(),
      summary,
      entities: [
        {
          type: 'unknown',
          confidence: 'low',
          data: { size, magic, preview }
        }
      ],
      warnings,
      errors
    };
  }
};

function identifyMagic(buf: Buffer): string | null {
  if (buf.length >= 16 && buf.slice(0, 16).toString('binary') === 'SQLite format 3\u0000') return 'sqlite3';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip/apk';
  if (buf.length >= 4 && buf[0] === 0x1f && buf[1] === 0x8b) return 'gzip';
  if (buf.length >= 4 && buf.slice(0, 4).toString('ascii') === 'ANDR') return 'android-backup';
  if (buf.length >= 5 && buf.slice(0, 5).toString('ascii') === '<?xml') return 'xml';
  if (buf.length >= 1 && (buf[0] === 0x7b /* { */ || buf[0] === 0x5b /* [ */)) return 'json-ish';
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  return null;
}

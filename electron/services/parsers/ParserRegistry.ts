import { promises as fs } from 'node:fs';
import type { ArtifactRecord, ParsedArtifact } from '../../models/types';
import type { ArtifactParser } from './types';
import { SqliteParser } from './SqliteParser';
import { JsonParser } from './JsonParser';
import { SharedPrefsXmlParser } from './SharedPrefsXmlParser';
import { BinaryProbeParser } from './BinaryProbeParser';
import type { Logger } from '../logging/Logger';

export class ParserRegistry {
  private parsers: ArtifactParser[];
  constructor(private logger: Logger, parsers?: ArtifactParser[]) {
    // Order matters only for tie-breaking; specificity drives the choice.
    this.parsers = parsers ?? [SqliteParser, SharedPrefsXmlParser, JsonParser, BinaryProbeParser];
  }

  register(parser: ArtifactParser): void {
    this.parsers.unshift(parser);
  }

  /**
   * Probes every parser cheaply, picks the highest-specificity match, and
   * runs the full parse. Returns null only if reading the head bytes fails.
   */
  async parse(artifact: ArtifactRecord): Promise<ParsedArtifact | null> {
    let head: Buffer;
    try {
      head = await readHead(artifact.hostPath, 64);
    } catch (err) {
      this.logger.warn('parser', 'could not read head', { artifact: artifact.id, err: String(err) });
      return null;
    }

    let best: { parser: ArtifactParser; specificity: number } | null = null;
    for (const p of this.parsers) {
      try {
        const m = await p.probe(artifact, head);
        if (m && (!best || m.specificity > best.specificity)) {
          best = { parser: p, specificity: m.specificity };
        }
      } catch (err) {
        this.logger.warn('parser', 'probe threw', { parser: p.id, err: String(err) });
      }
    }
    if (!best) return null;
    this.logger.info('parser', 'parsing', { artifact: artifact.fileName, parser: best.parser.id, specificity: best.specificity });
    return best.parser.parse(artifact);
  }
}

async function readHead(path: string, n: number): Promise<Buffer> {
  const fh = await fs.open(path, 'r');
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.slice(0, bytesRead);
  } finally {
    await fh.close();
  }
}

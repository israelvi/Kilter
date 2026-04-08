import type { ArtifactRecord, ParsedArtifact } from '../../models/types';

export interface ParserMatch {
  parserId: string;
  /** Higher = more specific. The registry runs probes in declared order and picks the first match. */
  specificity: number;
}

export interface ArtifactParser {
  id: string;
  /** Cheap probe — open the file, sniff a few bytes, return null if not a match. */
  probe(file: ArtifactRecord, head: Buffer): Promise<ParserMatch | null>;
  parse(file: ArtifactRecord): Promise<ParsedArtifact>;
}

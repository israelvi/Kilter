import { promises as fs } from 'node:fs';
import type { ArtifactRecord, ParsedArtifact, ParsedEntity } from '../../models/types';
import type { ArtifactParser } from './types';

/**
 * Android SharedPreferences XML files have a fixed structure:
 *   <?xml version='1.0' encoding='utf-8' standalone='yes' ?>
 *   <map>
 *     <string name="key">value</string>
 *     <int name="key" value="1" />
 *     <boolean name="key" value="true" />
 *     ...
 *   </map>
 *
 * We do not need a full XML parser for this — a small regex-based reader
 * is sufficient and avoids adding a dependency.
 */
export const SharedPrefsXmlParser: ArtifactParser = {
  id: 'shared-prefs-xml',
  async probe(file, head) {
    const text = head.toString('utf8');
    if (text.includes('<map') && file.fileName.toLowerCase().endsWith('.xml')) {
      return { parserId: 'shared-prefs-xml', specificity: 70 };
    }
    return null;
  },
  async parse(file): Promise<ParsedArtifact> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const data: Record<string, unknown> = {};

    try {
      const text = await fs.readFile(file.hostPath, 'utf8');
      const stringRe = /<string\s+name="([^"]+)"\s*>([\s\S]*?)<\/string>/g;
      const intRe = /<int\s+name="([^"]+)"\s+value="([^"]+)"\s*\/>/g;
      const longRe = /<long\s+name="([^"]+)"\s+value="([^"]+)"\s*\/>/g;
      const boolRe = /<boolean\s+name="([^"]+)"\s+value="([^"]+)"\s*\/>/g;
      const floatRe = /<float\s+name="([^"]+)"\s+value="([^"]+)"\s*\/>/g;

      let m: RegExpExecArray | null;
      while ((m = stringRe.exec(text))) data[m[1]] = decodeXmlEntities(m[2]);
      while ((m = intRe.exec(text))) data[m[1]] = Number.parseInt(m[2], 10);
      while ((m = longRe.exec(text))) data[m[1]] = Number.parseInt(m[2], 10);
      while ((m = boolRe.exec(text))) data[m[1]] = m[2] === 'true';
      while ((m = floatRe.exec(text))) data[m[1]] = Number.parseFloat(m[2]);
    } catch (err) {
      errors.push(`shared-prefs parse failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const entity: ParsedEntity = {
      type: 'config',
      confidence: 'medium',
      data
    };

    return {
      artifactId: file.id,
      parserId: 'shared-prefs-xml',
      parsedAt: new Date().toISOString(),
      summary: `shared prefs xml (${Object.keys(data).length} keys)`,
      entities: [entity],
      warnings,
      errors
    };
  }
};

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

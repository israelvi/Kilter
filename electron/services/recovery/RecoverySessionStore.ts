import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ArtifactRecord, ParsedArtifact, RecoverySession, StrategyResult } from '../../models/types';

/**
 * In-memory store of RecoverySession instances. Each session also has a
 * workspace directory on disk where pulled artifacts and the NDJSON log
 * for that session are written.
 */
export class RecoverySessionStore {
  private sessions = new Map<string, RecoverySession>();

  constructor(private rootDir: string) {}

  async create(initial: Omit<RecoverySession, 'id' | 'createdAt' | 'workspaceDir' | 'logFile' | 'strategyResults' | 'artifacts' | 'parsed'>): Promise<RecoverySession> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const workspaceDir = join(this.rootDir, `session-${id}`);
    const logFile = join(workspaceDir, 'session.log.ndjson');
    await fs.mkdir(join(workspaceDir, 'raw'), { recursive: true });
    await fs.mkdir(join(workspaceDir, 'parsed'), { recursive: true });
    const session: RecoverySession = {
      id,
      createdAt,
      workspaceDir,
      logFile,
      strategyResults: [],
      artifacts: [],
      parsed: [],
      ...initial
    };
    this.sessions.set(id, session);
    await this.persist(session);
    return session;
  }

  get(id: string): RecoverySession | null {
    return this.sessions.get(id) ?? null;
  }

  list(): RecoverySession[] {
    return [...this.sessions.values()];
  }

  async update(id: string, mutator: (s: RecoverySession) => void): Promise<RecoverySession> {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`session ${id} not found`);
    mutator(s);
    await this.persist(s);
    return s;
  }

  async addStrategyResult(id: string, r: StrategyResult): Promise<void> {
    await this.update(id, (s) => {
      const idx = s.strategyResults.findIndex((x) => x.strategyId === r.strategyId);
      if (idx >= 0) s.strategyResults[idx] = r; else s.strategyResults.push(r);
    });
  }

  async addArtifact(id: string, a: ArtifactRecord): Promise<void> {
    await this.update(id, (s) => { s.artifacts.push(a); });
  }

  async addParsed(id: string, p: ParsedArtifact): Promise<void> {
    await this.update(id, (s) => { s.parsed.push(p); });
  }

  private async persist(s: RecoverySession): Promise<void> {
    try {
      const file = join(s.workspaceDir, 'session.json');
      await fs.writeFile(file, JSON.stringify(s, null, 2), 'utf8');
    } catch {
      // Persistence is best-effort; in-memory remains the source of truth.
    }
  }
}

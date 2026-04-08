import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import type {
  ArtifactRecord,
  Capability,
  ConfidenceLevel,
  PackageInfo,
  RecoverySession,
  StrategyResult
} from '../../models/types';
import type { AdbService } from '../adb/AdbService';
import type { Logger } from '../logging/Logger';
import type { RecoverySessionStore } from './RecoverySessionStore';
import type { ParserRegistry } from '../parsers/ParserRegistry';

export interface StrategyContext {
  session: RecoverySession;
  adb: AdbService;
  logger: Logger;
  store: RecoverySessionStore;
  /** Helpers strategies use to register findings. */
  registerArtifact(a: Omit<ArtifactRecord, 'id' | 'sha256' | 'sessionId'>): Promise<ArtifactRecord>;
  /** Live capability map for this session. */
  capabilities: Record<Capability, boolean>;
  /** Strategy can detect a package and update the session. */
  detectedPackages: PackageInfo[];
  emitProgress(message: string): void;
}

export interface RecoveryStrategy {
  id: string;
  description: string;
  /** Capabilities the strategy needs. */
  requires: Capability[];
  /** Returns a result. Throwing is allowed; engine catches and records. */
  run(ctx: StrategyContext): Promise<Omit<StrategyResult, 'strategyId' | 'startedAt' | 'finishedAt' | 'durationMs' | 'required' | 'missing' | 'status'> & { status?: StrategyResult['status'] }>;
}

export class StrategyEngine {
  constructor(
    private strategies: RecoveryStrategy[],
    private adb: AdbService,
    private logger: Logger,
    private store: RecoverySessionStore,
    private parsers: ParserRegistry,
    private onProgress: (sessionId: string, phase: string, message: string) => void
  ) {}

  async run(sessionId: string): Promise<RecoverySession> {
    const session = this.store.get(sessionId);
    if (!session) throw new Error(`session ${sessionId} not found`);

    const ctx: StrategyContext = {
      session,
      adb: this.adb,
      logger: this.logger,
      store: this.store,
      capabilities: { ...session.capabilities },
      detectedPackages: session.detectedPackages,
      emitProgress: (msg) => this.onProgress(sessionId, 'strategy', msg),
      registerArtifact: async (a) => {
        const buf = await fs.readFile(a.hostPath).catch(() => Buffer.alloc(0));
        const sha256 = createHash('sha256').update(buf).digest('hex');
        const id = `${sha256.slice(0, 12)}-${basename(a.hostPath)}`;
        const record: ArtifactRecord = { id, sha256, sessionId, ...a };
        await this.store.addArtifact(sessionId, record);
        return record;
      }
    };

    for (const strat of this.strategies) {
      const startedAt = new Date().toISOString();
      const t0 = Date.now();
      const missing = strat.requires.filter((c) => !ctx.capabilities[c]);
      if (missing.length > 0) {
        const skipped: StrategyResult = {
          strategyId: strat.id,
          status: 'skipped',
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - t0,
          required: strat.requires,
          missing,
          attempted: [],
          artifactIds: [],
          confidence: 'low',
          notes: [`skipped: missing capabilities: ${missing.join(', ')}`],
          errors: []
        };
        await this.store.addStrategyResult(sessionId, skipped);
        this.logger.info('engine', `skipped ${strat.id}`, { missing });
        this.onProgress(sessionId, 'strategy.skipped', strat.id);
        continue;
      }

      this.onProgress(sessionId, 'strategy.start', strat.id);
      this.logger.info('engine', `running ${strat.id}`);
      try {
        const partial = await strat.run(ctx);
        const finishedAt = new Date().toISOString();
        const result: StrategyResult = {
          strategyId: strat.id,
          status: partial.status ?? 'success',
          startedAt,
          finishedAt,
          durationMs: Date.now() - t0,
          required: strat.requires,
          missing: [],
          attempted: partial.attempted,
          artifactIds: partial.artifactIds,
          confidence: partial.confidence,
          notes: partial.notes,
          errors: partial.errors
        };
        await this.store.addStrategyResult(sessionId, result);
        this.onProgress(sessionId, 'strategy.done', `${strat.id}: ${result.status}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const failed: StrategyResult = {
          strategyId: strat.id,
          status: 'failed',
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - t0,
          required: strat.requires,
          missing: [],
          attempted: [],
          artifactIds: [],
          confidence: 'low',
          notes: [],
          errors: [msg]
        };
        await this.store.addStrategyResult(sessionId, failed);
        this.logger.error('engine', `strategy ${strat.id} threw`, { error: msg });
        this.onProgress(sessionId, 'strategy.error', `${strat.id}: ${msg}`);
      }
    }

    // Parse newly registered artifacts.
    this.onProgress(sessionId, 'parse.start', 'parsing artifacts');
    const fresh = this.store.get(sessionId)!;
    for (const artifact of fresh.artifacts) {
      try {
        const parsed = await this.parsers.parse(artifact);
        if (parsed) {
          await this.store.addParsed(sessionId, parsed);
          this.onProgress(sessionId, 'parse.done', `${artifact.fileName}: ${parsed.parserId}`);
        }
      } catch (err) {
        this.logger.error('engine', 'parser threw', { artifact: artifact.id, error: String(err) });
      }
    }

    this.onProgress(sessionId, 'session.done', 'all strategies complete');
    return this.store.get(sessionId)!;
  }
}

export function confidenceMax(a: ConfidenceLevel, b: ConfidenceLevel): ConfidenceLevel {
  const order = { low: 0, medium: 1, high: 2 } as const;
  return order[a] >= order[b] ? a : b;
}

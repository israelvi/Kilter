import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { LogEntry } from '../../models/types';

type Listener = (entry: LogEntry) => void;

export class Logger {
  private buffer: LogEntry[] = [];
  private readonly maxBuffer = 2000;
  private listeners = new Set<Listener>();
  private fileQueue: Promise<void> = Promise.resolve();

  constructor(private filePath: string | null = null) {}

  setFilePath(filePath: string): void {
    this.filePath = filePath;
  }

  onEntry(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  tail(limit = 500): LogEntry[] {
    return this.buffer.slice(-limit);
  }

  debug(scope: string, msg: string, data?: Record<string, unknown>) { this.write('debug', scope, msg, data); }
  info(scope: string, msg: string, data?: Record<string, unknown>)  { this.write('info',  scope, msg, data); }
  warn(scope: string, msg: string, data?: Record<string, unknown>)  { this.write('warn',  scope, msg, data); }
  error(scope: string, msg: string, data?: Record<string, unknown>) { this.write('error', scope, msg, data); }

  private write(level: LogEntry['level'], scope: string, msg: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = { ts: new Date().toISOString(), level, scope, msg, data };
    this.buffer.push(entry);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer.splice(0, this.buffer.length - this.maxBuffer);
    }
    for (const l of this.listeners) {
      try { l(entry); } catch { /* listener errors must never affect logging */ }
    }
    if (this.filePath) {
      const line = JSON.stringify(entry) + '\n';
      const target = this.filePath;
      this.fileQueue = this.fileQueue.then(async () => {
        try {
          await fs.mkdir(dirname(target), { recursive: true });
          await fs.appendFile(target, line, 'utf8');
        } catch {
          // Logging must never throw.
        }
      });
    }
  }
}

/** Process-wide singleton; main creates and shares it. */
export const rootLogger = new Logger();

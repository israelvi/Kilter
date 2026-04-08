import { useEffect, useRef, useState } from 'react';
import { ipc } from '../ipc/bridge';
import { useStore } from '../state/store';
import type { LogEntry } from '@models/types';

export function DiagnosticsScreen() {
  const liveLogs = useStore((s) => s.logs);
  const [filter, setFilter] = useState('');
  const [seed, setSeed] = useState<LogEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void ipc().diagnostics.tail(500).then(setSeed);
  }, []);

  // Merge initial tail with live entries, dedup by ts+msg.
  const all: LogEntry[] = [...seed, ...liveLogs];
  const seen = new Set<string>();
  const merged: LogEntry[] = [];
  for (const e of all) {
    const k = `${e.ts}|${e.scope}|${e.msg}`;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(e);
  }
  const filtered = filter
    ? merged.filter((e) => `${e.scope} ${e.msg} ${JSON.stringify(e.data ?? {})}`.toLowerCase().includes(filter.toLowerCase()))
    : merged;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [filtered.length]);

  return (
    <>
      <h2>Diagnostics</h2>
      <p className="lede">
        Every ADB command, every file scan, every parser invocation, every export — all logged here in
        real time. Useful for trust, debugging, and producing a forensic audit trail.
      </p>

      <div className="card">
        <input
          type="search"
          placeholder="Filter by scope or message…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div style={{ marginTop: 12, maxHeight: 520, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
          {filtered.length === 0 && <div className="empty" style={{ border: 'none' }}>No log entries.</div>}
          {filtered.map((e, i) => (
            <div key={i} className={`log-line ${e.level}`}>
              <span className="ts">{e.ts}</span>
              <span className="scope">[{e.scope}]</span>
              <span>{e.msg}</span>
              {e.data && <span style={{ color: 'var(--text-faint)' }}> {JSON.stringify(e.data)}</span>}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="meta" style={{ marginTop: 8 }}>{filtered.length} of {merged.length} entries</div>
      </div>
    </>
  );
}

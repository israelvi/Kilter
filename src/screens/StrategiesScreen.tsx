import { useState } from 'react';
import { ipc } from '../ipc/bridge';
import { store, useStore } from '../state/store';

export function StrategiesScreen() {
  const session = useStore((s) => s.session);
  const progress = useStore((s) => s.progress);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAll() {
    if (!session) return;
    setBusy(true); setError(null);
    store.set({ progress: [] });
    try {
      const next = await ipc().session.runStrategies(session.id);
      store.set({ session: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (!session) return <h2>No session</h2>;

  return (
    <>
      <h2>Recovery strategies</h2>
      <p className="lede">
        Each strategy declares the device capabilities it requires. The engine runs only the
        strategies whose requirements are satisfied; the rest are <em>skipped</em> with a reason.
        Both states are honest data.
      </p>

      {error && <div className="notice bad">{error}</div>}

      <div className="row" style={{ marginBottom: 16 }}>
        <button className="primary" onClick={() => void runAll()} disabled={busy}>
          {busy ? 'Running…' : 'Run all strategies'}
        </button>
        {busy && <span className="meta">{progress[progress.length - 1]}</span>}
      </div>

      {session.strategyResults.length === 0 && (
        <div className="empty">No strategies have run yet. Click the button above.</div>
      )}

      {session.strategyResults.map((r) => {
        const cls = r.status === 'success' ? 'good'
          : r.status === 'partial' ? 'warn'
          : r.status === 'skipped' ? 'dim'
          : r.status === 'failed'  ? 'bad'
          : 'dim';
        return (
          <div className="card" key={r.strategyId}>
            <div className="row spread">
              <h3>{r.strategyId}</h3>
              <span className={`badge ${cls}`}>{r.status}</span>
            </div>
            <div className="meta" style={{ marginBottom: 8 }}>
              {r.durationMs ?? '—'}ms · confidence {r.confidence} · {r.artifactIds.length} artifact(s)
            </div>
            {r.required.length > 0 && (
              <div className="row" style={{ marginBottom: 8 }}>
                {r.required.map((c) => (
                  <span key={c} className={`badge ${r.missing.includes(c) ? 'bad' : 'dim'}`}>{c}</span>
                ))}
              </div>
            )}
            {r.attempted.length > 0 && (
              <details>
                <summary className="meta">Attempted ({r.attempted.length})</summary>
                <pre>{r.attempted.join('\n')}</pre>
              </details>
            )}
            {r.notes.length > 0 && (
              <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                {r.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}
            {r.errors.length > 0 && (
              <ul style={{ marginTop: 8, paddingLeft: 18, color: 'var(--bad)' }}>
                {r.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        );
      })}

      <div className="footer-actions">
        <button onClick={() => store.set({ screen: 'kilter' })}>← Back</button>
        <span className="spacer" />
        <button className="primary" onClick={() => store.set({ screen: 'findings' })}>
          View findings →
        </button>
      </div>
    </>
  );
}

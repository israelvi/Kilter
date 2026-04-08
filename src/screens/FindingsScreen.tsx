import { store, useStore } from '../state/store';
import type { ParsedArtifact } from '@models/types';

export function FindingsScreen() {
  const session = useStore((s) => s.session);
  if (!session) return <h2>No session</h2>;

  const groupedByEntity = new Map<string, ParsedArtifact[]>();
  for (const p of session.parsed) {
    for (const e of p.entities) {
      const key = e.type;
      if (!groupedByEntity.has(key)) groupedByEntity.set(key, []);
      groupedByEntity.get(key)!.push(p);
    }
  }

  return (
    <>
      <h2>Findings</h2>
      <p className="lede">
        Parsed artifacts from this session, grouped by inferred entity type. Confidence is conservative —
        unknown is the default until a parser positively identifies the file.
      </p>

      <div className="card">
        <h3>Summary</h3>
        <dl className="kv">
          <dt>Artifacts pulled</dt><dd>{session.artifacts.length}</dd>
          <dt>Parsed</dt><dd>{session.parsed.length}</dd>
          <dt>Strategies run</dt><dd>{session.strategyResults.filter(r => r.status !== 'skipped').length} / {session.strategyResults.length}</dd>
        </dl>
      </div>

      {session.parsed.length === 0 && (
        <div className="empty">
          Nothing parsed yet. Run the strategies first.
        </div>
      )}

      {[...groupedByEntity.entries()].map(([type, arts]) => (
        <div className="card" key={type}>
          <h3>{type} <span className="meta">({arts.length})</span></h3>
          {arts.map((p) => (
            <div key={p.artifactId + p.parserId} style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <div className="meta">parser: {p.parserId} · {p.parsedAt}</div>
              <div style={{ margin: '6px 0' }}>{p.summary}</div>
              <details>
                <summary className="meta">entities ({p.entities.length})</summary>
                <pre>{JSON.stringify(p.entities, null, 2)}</pre>
              </details>
              {p.warnings.length > 0 && (
                <div className="meta" style={{ color: 'var(--warn)' }}>
                  warnings: {p.warnings.join('; ')}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}

      <div className="card">
        <h3>Raw artifacts</h3>
        {session.artifacts.length === 0 && <div className="empty">No artifacts.</div>}
        {session.artifacts.map((a) => (
          <div key={a.id} style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{a.fileName}</div>
            <div className="meta">
              sha256 {a.sha256.slice(0, 16)}… · from {a.sourceDevicePath ?? 'host-only'} · via {a.acquisitionMethod}
              {a.selectionReason ? ` · reason: ${a.selectionReason}` : ''}
            </div>
          </div>
        ))}
      </div>

      <div className="footer-actions">
        <button onClick={() => store.set({ screen: 'strategies' })}>← Back</button>
        <span className="spacer" />
        <button className="primary" onClick={() => store.set({ screen: 'export' })}>
          Export →
        </button>
      </div>
    </>
  );
}

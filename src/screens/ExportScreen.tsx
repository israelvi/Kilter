import { useState } from 'react';
import { ipc } from '../ipc/bridge';
import { store, useStore } from '../state/store';
import type { ExportBundleInfo } from '@models/types';

export function ExportScreen() {
  const session = useStore((s) => s.session);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ExportBundleInfo | null>(null);

  async function pickAndExport() {
    if (!session) return;
    const dir = await ipc().dialog.pickDirectory();
    if (!dir) return;
    setBusy(true); setError(null);
    try {
      const b = await ipc().session.export(session.id, dir);
      setBundle(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (!session) return <h2>No session</h2>;

  return (
    <>
      <h2>Export evidence bundle</h2>
      <p className="lede">
        Writes a self-contained directory containing every raw artifact, every parsed JSON,
        the full session record, machine-readable and human-readable reports, and the session log.
      </p>

      <div className="card">
        <h3>Bundle contents</h3>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li><code>raw/</code> — verbatim copies of every pulled artifact, named by sha256</li>
          <li><code>parsed/</code> — one normalized JSON per parsed artifact</li>
          <li><code>session.json</code> — the full RecoverySession with provenance</li>
          <li><code>report.json</code> — machine-readable summary</li>
          <li><code>report.md</code> — human-readable summary</li>
          <li><code>logs.ndjson</code> — structured logs from this session</li>
        </ul>
      </div>

      {error && <div className="notice bad">{error}</div>}

      {bundle && (
        <div className="notice">
          <strong>Bundle written:</strong>
          <div className="meta" style={{ marginTop: 6 }}><code>{bundle.bundleDir}</code></div>
          <div className="meta" style={{ marginTop: 6 }}>{bundle.files.length} files · {bundle.createdAt}</div>
        </div>
      )}

      <div className="footer-actions">
        <button onClick={() => store.set({ screen: 'findings' })}>← Back</button>
        <span className="spacer" />
        <button className="primary" onClick={() => void pickAndExport()} disabled={busy}>
          {busy ? 'Writing…' : 'Pick a directory and export'}
        </button>
      </div>
    </>
  );
}

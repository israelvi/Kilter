import { useState } from 'react';
import { ipc } from '../ipc/bridge';
import { store, useStore } from '../state/store';

export function KilterDetectionScreen() {
  const session = useStore((s) => s.session);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runDetection() {
    if (!session) return;
    setBusy(true); setError(null);
    try {
      // The package detection strategy will run as part of the full pipeline.
      // We trigger the engine here so the user sees results before hitting Strategies.
      const next = await ipc().session.runStrategies(session.id);
      store.set({ session: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (!session) {
    return (
      <>
        <h2>No session</h2>
        <button onClick={() => store.set({ screen: 'connect' })}>← Back to Connect</button>
      </>
    );
  }

  const detectionResult = session.strategyResults.find((r) => r.strategyId === 'package.detection');

  return (
    <>
      <h2>Kilter package detection</h2>
      <p className="lede">
        Looks for known and likely Kilter Board package identifiers via <code>pm list packages</code>,
        and reads <code>dumpsys package</code> for each match to capture version, install times, and
        the manifest flags that determine which recovery strategies are usable.
      </p>

      {error && <div className="notice bad">{error}</div>}

      <div className="card">
        <div className="row spread">
          <h3>Detection</h3>
          <button className="primary" onClick={() => void runDetection()} disabled={busy}>
            {busy ? 'Running…' : detectionResult ? 'Re-run' : 'Run detection'}
          </button>
        </div>
        {detectionResult && (
          <div style={{ marginTop: 12 }}>
            <span className={`badge ${detectionResult.status === 'success' ? 'good' : 'warn'}`}>
              {detectionResult.status}
            </span>{' '}
            <span className="meta">{detectionResult.durationMs}ms · confidence {detectionResult.confidence}</span>
            <ul style={{ marginTop: 12 }}>
              {detectionResult.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </div>
        )}
      </div>

      {session.detectedPackages.length > 0 && (
        <div className="card">
          <h3>Detected packages</h3>
          {session.detectedPackages.map((p) => (
            <div key={p.packageId} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 14, marginBottom: 8 }}>{p.packageId}</div>
              <dl className="kv">
                <dt>Version</dt><dd>{p.versionName ?? '—'} (code {p.versionCode ?? '—'})</dd>
                <dt>First installed</dt><dd>{p.firstInstallTime ?? '—'}</dd>
                <dt>Last updated</dt><dd>{p.lastUpdateTime ?? '—'}</dd>
                <dt>allowBackup</dt><dd>{String(p.allowBackup ?? '—')}</dd>
                <dt>debuggable</dt><dd>{String(p.debuggable ?? '—')}</dd>
                <dt>APK paths</dt><dd>{p.apkPaths.join('\n') || '—'}</dd>
              </dl>
            </div>
          ))}
        </div>
      )}

      <div className="footer-actions">
        <button onClick={() => store.set({ screen: 'device' })}>← Back</button>
        <span className="spacer" />
        <button className="primary" onClick={() => store.set({ screen: 'strategies' })}>
          Recovery strategies →
        </button>
      </div>
    </>
  );
}

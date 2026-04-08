import { useEffect, useState } from 'react';
import { ipc } from '../ipc/bridge';
import { store, useStore } from '../state/store';

export function DeviceScanScreen() {
  const serial = useStore((s) => s.selectedSerial);
  const session = useStore((s) => s.session);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (serial && (!session || session.device.serial !== serial)) {
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial]);

  async function start() {
    if (!serial) return;
    setBusy(true); setError(null);
    try {
      const s = await ipc().session.start(serial);
      store.set({ session: s });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (!serial) {
    return (
      <>
        <h2>No device selected</h2>
        <p className="lede">Go back to Connect and pick an authorized device.</p>
        <div className="footer-actions">
          <button onClick={() => store.set({ screen: 'connect' })}>← Back to Connect</button>
        </div>
      </>
    );
  }

  return (
    <>
      <h2>Device scan</h2>
      <p className="lede">
        We've talked to the device, captured its profile, and probed which capabilities are available.
        Each capability gates a different recovery strategy.
      </p>

      {error && <div className="notice bad">{error}</div>}
      {busy && <div className="notice">Scanning…</div>}

      {session && (
        <>
          <div className="card">
            <h3>Device profile</h3>
            <dl className="kv">
              <dt>Serial</dt><dd>{session.device.serial}</dd>
              <dt>Manufacturer</dt><dd>{session.device.manufacturer ?? '—'}</dd>
              <dt>Model</dt><dd>{session.device.model ?? '—'}</dd>
              <dt>Brand</dt><dd>{session.device.brand ?? '—'}</dd>
              <dt>Android version</dt><dd>{session.device.androidVersion ?? '—'}</dd>
              <dt>SDK level</dt><dd>{session.device.sdkInt ?? '—'}</dd>
              <dt>ABI</dt><dd>{session.device.abi ?? '—'}</dd>
              <dt>Build fingerprint</dt><dd>{session.device.buildFingerprint ?? '—'}</dd>
            </dl>
          </div>

          <div className="card">
            <h3>Capabilities</h3>
            <div className="row">
              {Object.entries(session.capabilities).map(([k, v]) => (
                <span key={k} className={`badge ${v ? 'good' : 'dim'}`}>{k}{v ? '' : ' ✕'}</span>
              ))}
            </div>
            {session.device.sdkInt != null && session.device.sdkInt >= 30 && (
              <div className="notice warn" style={{ marginTop: 16 }}>
                Android {session.device.androidVersion} (SDK {session.device.sdkInt}) enforces Scoped Storage.
                Direct reads of <code>/sdcard/Android/data/&lt;pkg&gt;</code> are restricted, and
                <code>adb backup</code> is deprecated. Strategies will detect and report this.
              </div>
            )}
          </div>
        </>
      )}

      <div className="footer-actions">
        <button onClick={() => store.set({ screen: 'connect' })}>← Back</button>
        <span className="spacer" />
        <button
          className="primary"
          disabled={!session || busy}
          onClick={() => store.set({ screen: 'kilter' })}
        >
          Detect Kilter →
        </button>
      </div>
    </>
  );
}

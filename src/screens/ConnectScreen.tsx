import { useEffect, useState } from 'react';
import { ipc } from '../ipc/bridge';
import { store, useStore } from '../state/store';

export function ConnectScreen() {
  const adb = useStore((s) => s.adb);
  const devices = useStore((s) => s.devices);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void detect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function detect() {
    setBusy(true); setError(null);
    try {
      const info = await ipc().adb.detect();
      store.set({ adb: info });
      if (info.path) {
        const list = await ipc().adb.listDevices();
        store.set({ devices: list });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pickAdbBinary() {
    const path = await ipc().dialog.pickFile();
    if (!path) return;
    setBusy(true);
    try {
      const info = await ipc().adb.setBinaryPath(path);
      store.set({ adb: info });
      if (info.path) {
        const list = await ipc().adb.listDevices();
        store.set({ devices: list });
      } else {
        setError('That file did not respond to `adb version`.');
      }
    } finally { setBusy(false); }
  }

  async function selectDevice(serial: string) {
    store.set({ selectedSerial: serial, screen: 'device' });
  }

  return (
    <>
      <h2>Connect your Android device</h2>
      <p className="lede">
        Plug the phone in via USB. In Android settings, enable Developer Options
        (tap Build Number 7 times), then enable USB debugging. When prompted on the phone,
        approve this computer's RSA key.
      </p>

      <div className="card">
        <div className="row spread">
          <div>
            <h3>ADB binary</h3>
            <div className="meta">
              {adb?.path
                ? <>found at <code>{adb.path}</code> ({adb.source}){adb.version ? <> — {adb.version}</> : null}</>
                : 'not found on PATH or in common SDK locations'}
            </div>
          </div>
          <div className="row">
            <button onClick={() => void detect()} disabled={busy}>Re-detect</button>
            <button onClick={() => void pickAdbBinary()} disabled={busy}>Choose adb manually</button>
          </div>
        </div>
        {!adb?.path && (
          <div className="notice warn" style={{ marginTop: 16 }}>
            Install Android Platform Tools from <code>developer.android.com/studio/releases/platform-tools</code>{' '}
            and either add it to PATH, set the <code>ADB_PATH</code> env var, or click "Choose adb manually" above.
          </div>
        )}
      </div>

      <div className="card">
        <div className="row spread">
          <h3>Connected devices</h3>
          <button onClick={() => void detect()} disabled={busy || !adb?.path}>Refresh</button>
        </div>
        {error && <div className="notice bad">{error}</div>}
        {devices.length === 0 && (
          <div className="empty">
            {adb?.path
              ? 'No devices detected yet. Connect via USB, accept the debugging prompt on the phone, and click Refresh.'
              : 'Find adb first.'}
          </div>
        )}
        {devices.map((d) => (
          <div key={d.serial} className="row spread" style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{d.serial}</div>
              <div className="meta">
                {Object.entries(d.descriptors).map(([k, v]) => `${k}=${v}`).join(' · ') || '—'}
              </div>
            </div>
            <div className="row">
              <span className={`badge ${d.state === 'device' ? 'good' : d.state === 'unauthorized' ? 'warn' : 'bad'}`}>
                {d.state}
              </span>
              <button
                className="primary"
                disabled={d.state !== 'device'}
                onClick={() => void selectDevice(d.serial)}
              >
                Use this device →
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

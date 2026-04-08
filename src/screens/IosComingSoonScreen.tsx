export function IosComingSoonScreen() {
  return (
    <>
      <h2>iOS · Coming soon</h2>
      <p className="lede">
        iOS recovery is on the roadmap but not yet implemented. Phase 1 of this
        toolkit is intentionally Android-only.
      </p>

      <div className="card">
        <h3>Why not yet</h3>
        <p style={{ color: 'var(--text-dim)', lineHeight: 1.6 }}>
          iOS device data extraction is fundamentally different from Android. Apple's
          security model means there is no equivalent of <code>adb</code> for the user's
          own device, no equivalent of <code>pm path</code> to pull an IPA, and no
          equivalent of <code>/sdcard/Android/data/&lt;pkg&gt;/</code> for app-scoped
          external storage. The only viable Phase-1-style paths on iOS are:
        </p>
        <ul style={{ color: 'var(--text-dim)', lineHeight: 1.7 }}>
          <li>Encrypted iTunes/Finder backups (full device, requires user password)</li>
          <li>Sysdiagnose / IDeviceBackup tools (third-party libimobiledevice)</li>
          <li>iCloud backup retrieval (requires Apple ID + 2FA + per-device key)</li>
          <li>Jailbreak (out of scope for any non-root phase)</li>
        </ul>
        <p style={{ color: 'var(--text-dim)' }}>
          Each path has its own UX, dependencies, and legal/ethical considerations.
          We will design them properly when we get there — not bolt them on as a
          quick hack to the Android pipeline.
        </p>
      </div>

      <div className="card">
        <h3>What will be here when it ships</h3>
        <ul style={{ color: 'var(--text-dim)', lineHeight: 1.7 }}>
          <li><strong>Connect</strong> — pair iPhone via USB, trust prompt, libimobiledevice handshake</li>
          <li><strong>Device</strong> — model, iOS version, capacity, encryption status</li>
          <li><strong>Backup discovery</strong> — find existing iTunes/Finder backups on disk</li>
          <li><strong>Backup decryption</strong> — user-supplied password, extract Manifest.db</li>
          <li><strong>Kilter detection</strong> — locate the Kilter app's bundle and Documents directory inside the backup</li>
          <li><strong>Findings</strong> — same parser pipeline as Android (SQLite, plist, etc.)</li>
          <li><strong>Catalog</strong> — same browser as Android once we have a recovered db</li>
        </ul>
      </div>

      <div className="notice">
        Phase 1 is Android-only by design. The architecture (strategies, parsers,
        evidence model, catalog) is platform-agnostic, so adding iOS later is a
        matter of writing new strategies — not rewriting the app.
      </div>
    </>
  );
}

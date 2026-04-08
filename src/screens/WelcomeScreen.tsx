import { store } from '../state/store';

export function WelcomeScreen() {
  return (
    <>
      <h2>Kilter Recovery Kit</h2>
      <p className="lede">
        A desktop forensic-style toolkit for investigating local Kilter Board data on Android devices.
        It runs on your machine, talks only to your phone over USB, and never uploads anything unless
        you explicitly choose to export it later.
      </p>

      <div className="notice">
        <strong>Recovery is not guaranteed.</strong> This tool reports honestly what exists, what is
        accessible, what can be parsed, and what remains impossible without stronger access. You will
        see every command it runs in the Diagnostics tab.
      </div>

      <div className="card">
        <h3>What it does</h3>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Detects an Android device connected via USB and reports its profile.</li>
          <li>Looks for installed Kilter Board package(s) and pulls the APK if present.</li>
          <li>Runs structured recovery strategies, each declaring what it needs and what it found.</li>
          <li>Parses recovered candidate files (SQLite, JSON, Android shared prefs, generic binaries).</li>
          <li>Builds a self-contained evidence bundle you can export to a folder of your choice.</li>
        </ul>
      </div>

      <div className="card">
        <h3>What it does <em>not</em> do (this phase)</h3>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7, color: 'var(--text-dim)' }}>
          <li>Replace the Kilter Board app, control any climbing board over BLE, or publish routes.</li>
          <li>Touch any iOS device.</li>
          <li>Upload anything anywhere, ever, without an explicit user action.</li>
          <li>Require root. (A future "advanced mode" reserved hook is in the strategy interface.)</li>
        </ul>
      </div>

      <div className="footer-actions">
        <span className="spacer" />
        <button className="primary" onClick={() => store.set({ screen: 'connect' })}>
          Get started →
        </button>
      </div>
    </>
  );
}

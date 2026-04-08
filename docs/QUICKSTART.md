# Quickstart

Install, run, and troubleshoot the Kilter Recovery Kit.

## Prerequisites

| Tool | Required for | How to get it |
|---|---|---|
| **Bun** ≥ 1.3 | Everything | https://bun.sh |
| **Node.js** ≥ 20 | Electron tooling needs system Node available | https://nodejs.org |
| **`adb`** (Android Platform Tools) | Runtime — only when actually doing a recovery against a device | `winget install --id Google.PlatformTools` (Windows) <br/> `brew install --cask android-platform-tools` (macOS) <br/> [Direct download](https://developer.android.com/studio/releases/platform-tools) (Linux) |
| **`unzip`** | Catalog service uses it to extract APK contents | Git Bash on Windows / installed by default on macOS + Linux |

## Install

```bash
git clone https://github.com/israelvi/kilter-recovery-kit
cd kilter-recovery-kit
bun install
```

The `postinstall` hook automatically runs `electron-rebuild -f -w better-sqlite3` to compile the SQLite native module against Electron's Node ABI. **If you skip the postinstall (e.g. with `bun install --ignore-scripts`)**, run it manually:

```bash
bunx electron-rebuild -f -w better-sqlite3
```

## Run

### Dev mode (hot-reload)

```bash
bun run dev
```

This starts three processes via `concurrently`:

- **Vite** on `http://localhost:8101` (renderer hot-reload)
- **TypeScript watcher** on `tsconfig.electron.json` (main process recompile-on-save)
- **Electron** (waits for both, then launches the app via `scripts/run-electron.js`)

The window is titled **"Kilter Recovery Kit"**.

### Production build

```bash
bun run build
bun start
```

### Type-check only

```bash
bun run typecheck
```

## Try the catalog browser without doing a recovery

If you just want to see the catalog UI (boards, climbs, climb detail with rendered holds) without going through the full Android recovery flow:

### Option A — use the sample bundle dir

If `findings/android/sample/raw/` already has a `com.auroraclimbing.kilterboard__base.apk` in it:

1. `bun run dev`
2. In the app, click **Boards** → **Pick recovery bundle…**
3. Choose `findings/android/sample/`
4. The catalog service extracts the embedded SQLite database and board images on first open (~2 seconds)

### Option B — copy a real bundle into the sample dir

If you've already done a real recovery and have a bundle under `findings/android/KilterRecovery_*`:

```bash
node scripts/setup-sample-bundle.js
```

This copies the kilterboard base APK from your most recent recovery bundle into `findings/android/sample/raw/`. Then follow Option A.

## Troubleshooting

### `Error: NODE_MODULE_VERSION mismatch` at app launch
The native module `better-sqlite3` wasn't rebuilt for Electron's Node ABI. Run:
```bash
bunx electron-rebuild -f -w better-sqlite3
```
The `postinstall` hook should handle this automatically — if you're seeing it, the hook didn't run.

### Electron crashes immediately with `app.isPackaged is undefined`
Your environment has `ELECTRON_RUN_AS_NODE=1` set globally, which forces `electron .` to run as plain Node. The dev launcher [`scripts/run-electron.js`](../scripts/run-electron.js) explicitly strips this var. **Never invoke `electron .` directly** — always go through `bun run dev` or `bun start`.

### Window opens but loads a different app (or a blank page)
Check that the Electron main process is loading `http://localhost:8101`, not 5173 or another port. The Vite dev server is hard-coded to 8101 in `vite.config.ts`. If something else is using 8101, free it first:

```bash
# Windows (PowerShell)
Get-NetTCPConnection -LocalPort 8101 | Stop-Process -Id { $_.OwningProcess } -Force
# macOS / Linux
lsof -ti :8101 | xargs kill -9
```

### `adb` not found
Either install Android Platform Tools (`winget install --id Google.PlatformTools` on Windows) or click **"Choose adb manually"** on the Connect screen and point at the binary directly.

### Pixel won't show the "Allow USB debugging" prompt
- Make sure USB debugging is enabled in Settings → System → Developer Options
- Use a real **data** USB cable, not a charge-only one (the original Pixel cable always works)
- On Android 14+, pull down the notification shade and tap the "Charging this device via USB" notification → choose **File transfer**
- The prompt only appears when the phone is **unlocked**

### Window not resizable on Windows 11 (only fixable by maximizing first)
Already fixed in [electron/main.ts](../electron/main.ts) with explicit `resizable: true` + `setMinimumSize` after `ready-to-show`. If you still see this, your build is out of date — `bun run build` again, or stop+restart `bun run dev`.

### Closing the dev window kills the dev server
Already handled. The app re-opens the window automatically when you close it in dev mode (see [electron/main.ts](../electron/main.ts)). If the whole `concurrently` process tree dies, it means an internal error crashed Electron — check the dev terminal output.

### Catalog screen says "No catalog open"
You haven't picked a bundle yet. Click **"Pick recovery bundle…"** and select a directory containing a Kilter Board APK in its `raw/` subdirectory. If you've never run a recovery, see "Try the catalog browser without doing a recovery" above.

## Next steps

- **Want to run a real recovery?** See the [README](../README.md) walkthrough.
- **Want to extend the Android side?** See [docs/ANDROID_STATUS.md](ANDROID_STATUS.md) for the open TODO list.
- **Want to build the iOS side?** See [docs/IOS_ONBOARDING.md](IOS_ONBOARDING.md).
- **Want to understand the architecture?** See [docs/ARCHITECTURE.md](ARCHITECTURE.md).
- **AI agent reading this for the first time?** Read [CLAUDE.md](../CLAUDE.md).

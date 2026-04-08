# Kilter Recovery Kit — Agent guide

> **You are reading this because you are an AI coding agent (Claude or another LLM) that just opened this repository.** This file is your operating manual. Read it end-to-end before doing anything. The conventions, gotchas, and onboarding flows below exist because they were learned the hard way during Phase 1.

## What this project is

**Kilter Recovery Kit** is a desktop application — Electron + TypeScript + React — for forensically recovering, parsing, preserving, and **browsing** local Kilter Board climbing-app data from a user's own mobile device. It is **not** a replacement for the Kilter Board app. It is a **recovery toolkit** that answers the question: *"What useful Kilter-related data still exists locally on this device, and how reliably can we extract it?"*

The project is intentionally split into platform branches:

- **Android (Phase 1)** — **complete and working.** Full recovery pipeline + in-app catalog browser. See [docs/ANDROID_STATUS.md](docs/ANDROID_STATUS.md) for the detailed state.
- **iOS (Phase 2)** — **not started.** Architecture is platform-agnostic and ready to host iOS strategies. See [docs/IOS_ONBOARDING.md](docs/IOS_ONBOARDING.md) for the dev tour.

## Critical conventions — read before coding

These exist because someone (Claude included) tripped over them at least once.

### Package manager

**Use `bun` for everything. Never `npm`, never `yarn`, never `pnpm`.**

```bash
bun install            # not npm install
bun add <pkg>          # not npm install <pkg>
bun add -d <pkg>       # devDep, not npm install --save-dev
bun run <script>       # not npm run
bunx <bin>             # not npx
```

The lockfile is `bun.lock`. Do not commit a `package-lock.json`.

### Native modules: better-sqlite3 vs Electron ABI

`better-sqlite3` is a native C++ module. `bun install` compiles it against the system Node ABI (currently NODE_MODULE_VERSION 127), but Electron 32 embeds Node 20 with ABI 128. They are incompatible.

A `postinstall` hook in `package.json` runs `electron-rebuild -f -w better-sqlite3` automatically, so this should "just work" after `bun install`. **If you ever see `NODE_MODULE_VERSION mismatch` at runtime,** the postinstall didn't run or the Electron version changed:

```bash
bunx electron-rebuild -f -w better-sqlite3
```

### `ELECTRON_RUN_AS_NODE` poisoning

If the environment has `ELECTRON_RUN_AS_NODE=1` set, `electron .` silently runs as plain Node and `app.isPackaged` becomes `undefined`, crashing the main process. The dev launcher [scripts/run-electron.js](scripts/run-electron.js) explicitly **deletes** this env var before spawning Electron. **Always invoke Electron through this launcher**, never directly:

```json
"start": "node scripts/run-electron.js",
"dev":   "... && node scripts/run-electron.js"
```

### Vite dev port

The Vite dev server runs on **port 8101** (not the default 5173). The Electron main process loads `http://localhost:8101` in dev. If you see Electron loading the wrong app (e.g. another developer tool), check that **`electron/main.ts` and `vite.config.ts` agree on 8101**.

### Renderer vs main isolation

- The renderer (React) **never** imports anything from `electron/`. The only shared types are in `electron/models/*.ts` and are imported via the `@models/*` path alias as **type-only imports**.
- All renderer ↔ main communication goes through the typed bridge `window.kilter.*` defined in [electron/preload.ts](electron/preload.ts).
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Do not relax these.

### File / tool conventions

- **Read files** with the `Read` tool, never `cat`/`head`/`tail`.
- **Search** with `Grep` (ripgrep) and `Glob`, never `find`/`grep`/`ls`.
- **Edit** existing files with `Edit`, never write a new file unless absolutely required.
- **Create** new files with `Write`, never `echo > file` from Bash.
- **NEVER create documentation files** (`*.md`, README, etc.) unless explicitly requested by the user.
- **Never use emojis** in source files unless the user explicitly asks.

## How to run

Prerequisites:

- **Node.js 20+** (Bun ships with its own Node-compatible runtime, but Electron tooling needs system Node available).
- **Bun** ≥ 1.3 (https://bun.sh).
- **`adb`** (Android Platform Tools) — only needed at *runtime*, not for the build. Install via winget on Windows: `winget install --id Google.PlatformTools` or download from https://developer.android.com/studio/releases/platform-tools.
- **`unzip`** on PATH (Git Bash on Windows, or any *nix). Used to extract APK contents.

First-time setup:

```bash
bun install
# postinstall automatically rebuilds better-sqlite3 against Electron's Node ABI
```

Run in dev (hot-reload renderer + watch-rebuild electron + auto-launch the app):

```bash
bun run dev
```

This starts three processes via `concurrently`:
1. **vite** on :8101 (renderer)
2. **tsc -w** on `tsconfig.electron.json` (main process, watches for changes)
3. **electron** (waits for both, then spawns the app via `scripts/run-electron.js`)

Closing the Electron window in dev **automatically reopens it** (see [electron/main.ts](electron/main.ts:80) — this is intentional, prevents `concurrently -k` from tearing down vite + tsc on accidental window-close).

Build & start (production-ish):

```bash
bun run build
bun start
```

Type-check only:

```bash
bun run typecheck
```

## Repository layout

```
docs/
  ARCHITECTURE.md         high-level architecture, module boundaries, data flow
  FEASIBILITY.md          recovery feasibility on Android (what's possible without root)
  STRATEGY_MATRIX.md      capability matrix → which strategy runs when
  ROADMAP.md              phase plan
  ANDROID_STATUS.md       Phase 1 state: what's done, validated facts, known gotchas
  IOS_ONBOARDING.md       guided tour for the iOS Phase 2 developer

electron/                 main process (Node, never imported by renderer)
  main.ts                 BrowserWindow, IPC wiring, service bootstrap
  preload.ts              typed contextBridge → window.kilter
  ipc.ts                  single registration point for all IPC channels
  models/                 shared TypeScript types (compile-time only)
    types.ts                core RecoverySession / Strategy / Artifact types
    catalogTypes.ts         Catalog browser types (BoardConfig / ClimbDetail / etc.)
    kilterPackages.ts       known Kilter package ids and search hints
  services/
    adb/                  Android Debug Bridge wrapper
      AdbBinary.ts          binary discovery (PATH, ADB_PATH, SDK locations, WinGet)
      AdbService.ts         spawn-based wrapper, structured commands, devices+getprop
    recovery/             Strategy engine + per-strategy implementations
      RecoverySessionStore.ts
      StrategyEngine.ts
      strategies/
        DeviceProfileStrategy.ts          getprop → DeviceProfile
        PackageDetectionStrategy.ts       pm list + dumpsys for known package ids
        ApkExtractStrategy.ts             pm path + adb pull → APK files
        AccessibleStorageScanStrategy.ts  /sdcard targeted + broad scan
        DumpsysIntelStrategy.ts           indirect evidence
        index.ts                          strategy registration
    parsers/              Pluggable artifact parser registry
      ParserRegistry.ts
      SqliteParser.ts                better-sqlite3, schema + sample classification
      JsonParser.ts                  JSON probe + structural preview
      SharedPrefsXmlParser.ts        Android <map> XML
      BinaryProbeParser.ts           catch-all magic-byte sniffer
    catalog/              In-app Kilter catalog browser backend
      KilterCatalogService.ts          opens recovered db.sqlite3, precomputes
                                       boards/climbs/images, exposes queries
    export/
      ExportService.ts               writes self-contained evidence bundles
    logging/
      Logger.ts                      NDJSON file + ring buffer + listener fan-out

src/                      renderer (React, sandboxed, no Node)
  main.tsx                React entry
  App.tsx                 sidebar with Android/iOS branches + screen routing
  styles.css              hand-rolled CSS (no Tailwind / no UI lib)
  state/store.ts          minimal useSyncExternalStore-based store
  ipc/bridge.ts           the only place that touches window.kilter
  screens/                one .tsx per screen
    WelcomeScreen.tsx
    ConnectScreen.tsx
    DeviceScanScreen.tsx
    KilterDetectionScreen.tsx
    StrategiesScreen.tsx
    FindingsScreen.tsx
    ExportScreen.tsx
    DiagnosticsScreen.tsx
    BoardsScreen.tsx       catalog: grid of board configurations
    ClimbsScreen.tsx       catalog: searchable/filterable climb list
    ClimbDetailScreen.tsx  catalog: full climb with SVG hold overlay
    IosComingSoonScreen.tsx

scripts/
  run-electron.js         dev launcher that strips ELECTRON_RUN_AS_NODE
  inspect-sqlite.js       ad-hoc CLI: dump tables / sample rows from a sqlite file
  sqlite-schema.js        ad-hoc CLI: compact schema dump
  list-boards.js          ad-hoc CLI: list every Kilter board configuration
  export-all-climbs.js    ad-hoc CLI: bulk export all climbs to CSV/JSON
  render-climb.js         ad-hoc CLI: render a single climb to standalone HTML
  png-size.js             ad-hoc CLI: read PNG dimensions without deps

findings/                 GIT-IGNORED. Where recovery bundles + extracted catalog data live.
                          Each session bundle is a directory; the catalog browser
                          extracts a `_catalog/` subdir with the recovered SQLite db
                          and board images on first open.
```

## Architecture in 90 seconds

**Recovery side:**

```
ConnectScreen → AdbService.detect()/listDevices()
   ↓
DeviceScanScreen → ipc.session.start(serial)
   → catalog of capabilities probed via real adb commands
   ↓
KilterDetectionScreen / StrategiesScreen → ipc.session.runStrategies(id)
   → StrategyEngine runs each strategy in order
   → strategies that miss capabilities are SKIPPED with a documented reason
   → artifacts get registered with sha256 + provenance
   → ParserRegistry classifies each artifact by magic bytes / extension
   ↓
FindingsScreen → renders parsed entities grouped by type
ExportScreen → ExportService writes a self-contained bundle directory
```

**Catalog side (browser for the recovered Kilter database):**

```
BoardsScreen → user picks a recovery bundle directory
   → KilterCatalogService.openFromBundle(bundleDir)
   → finds the kilterboard base.apk inside <bundleDir>/raw/
   → extracts assets/db.sqlite3 and assets/img/product_sizes_layouts_sets/*
     into <bundleDir>/_catalog/ (one-time, ~1s)
   → opens the 190 MB SQLite read-only with better-sqlite3
   → preloadLookups()                       in-RAM lookup tables
   → precomputeBoardsAndClimbs()            parses 251k climbs once,
                                            buckets into 22 board configs
                                            with REAL set-aware counts
   ↓
ClimbsScreen → ipc.catalog.listClimbsForCombo(comboId, query)
   → uses precomputed uuid map, sorts/filters in RAM (sub-100ms)
   → query.grade filters by extracted V-grade
   → query.search filters by name OR setter substring
   → query.sortBy ∈ {popularity, quality, difficulty, newest, name}
   ↓
ClimbDetailScreen → ipc.catalog.getClimbDetail(uuid)
   → resolves frames "p<placement>r<role>" → (x, y) + role color
   → returns ClimbDetail with all per-angle stats + Instagram beta links
   → React renders SVG overlay on the board image with halo+glow filter
```

## Key facts about the recovered data

These were validated against a real Pixel 7 / Android 16 (SDK 36) on the project owner's device:

- **Confirmed Kilter package id:** `com.auroraclimbing.kilterboard` v3.9.18
- **Bonus discovery:** Same publisher also makes `com.auroraclimbing.tensionboard2` (v5.0.6)
- **Both have `allowBackup=true`** in manifest (unusual for modern apps) but `adb backup` is **dead in practice on Android 12+** (system suppresses the dialog).
- **Both have `debuggable=false`**, so `run-as` does not work.
- **The 190 MB embedded SQLite (`assets/db.sqlite3`) inside the APK contains the full public Kilter catalog**: 344k climbs, 348k per-angle stats, 32k Instagram beta links, 22 board configurations, 3,294 holes, 3,773 placements, 7,828 LEDs.
- The user's *personal* logbook (`ascents`, `bids`, `circuits`, `walls`, `tags`) lives in `/data/data/com.auroraclimbing.kilterboard/databases/<user-db>.sqlite3` which **requires root** to read on Android 11+. Phase 1 does not implement root.

See [docs/ANDROID_STATUS.md](docs/ANDROID_STATUS.md) for the full breakdown.

## Onboarding flows

### When the user says "I'm here to work on iOS"

This is a **first-class trigger**. The user has come to this project specifically to build the iOS Phase 2. They need a tour, not a code dump.

**Your job, in this order:**

1. **Greet them and confirm.** Say something like: *"You're here to work on iOS Phase 2 — let me give you the tour. I'll cover what this project is, what's already built (Android), the architecture you'll be reusing, what the iOS pipeline should look like, and where you'll be writing code."*

2. **Read [docs/IOS_ONBOARDING.md](docs/IOS_ONBOARDING.md)** in full. That document is the canonical tour. Walk the user through it interactively — don't just dump it on them. Pause at section breaks and ask if they want to dive deeper into any module, look at code, or move on.

3. **Show them the current Android implementation as a reference.** Specifically, walk them through:
   - The strategy engine and how a strategy is structured ([electron/services/recovery/StrategyEngine.ts](electron/services/recovery/StrategyEngine.ts) + any one strategy file)
   - The parser registry pattern ([electron/services/parsers/ParserRegistry.ts](electron/services/parsers/ParserRegistry.ts))
   - The IPC + types pattern (how `electron/ipc.ts` + `electron/preload.ts` + `electron/models/types.ts` stay in sync)
   - The catalog service as the model for "open a recovered db, query it, expose to renderer" ([electron/services/catalog/KilterCatalogService.ts](electron/services/catalog/KilterCatalogService.ts))

4. **Help them stub out an iOS service** when they're ready. Suggest `electron/services/ios/IosService.ts` as the parallel to `AdbService`, and walk through what its first methods should look like (e.g. `detectLibimobiledevice()`, `listConnectedIDevices()`, `getDeviceProfile(udid)`).

5. **Update [docs/IOS_ONBOARDING.md](docs/IOS_ONBOARDING.md) and [docs/ROADMAP.md](docs/ROADMAP.md)** as the iOS work progresses. Treat them as living documents.

### When the user says "I want to keep working on Android"

The Android implementation is feature-complete for Phase 1 but there is plenty to refine. Common asks:

- **More parsers** — APK parser, Realm parser, protobuf parser. Add to `electron/services/parsers/`.
- **More strategies** — `runas.extract` (only works on debuggable builds, document it honestly), `mediastore.query` (we have a probe for it but no full strategy), `root.full.extract` (Phase 3).
- **Catalog improvements** — favorites, gym presets, export filtered lists, multi-board comparison.
- **UX polish** — keyboard shortcuts, virtualized lists for large climb counts, dark/light theme toggle.

Read [docs/ANDROID_STATUS.md](docs/ANDROID_STATUS.md) for the current TODO list and known gotchas before touching code.

### When the user just says "set this up"

They are a fresh dev, never opened the project before. Run them through:

1. Verify `bun --version` ≥ 1.3 (`bun --version`)
2. Verify Node 20+ on PATH (`node --version`)
3. `bun install`
4. Verify the postinstall rebuilt better-sqlite3 (`ls node_modules/better-sqlite3/build/Release/better_sqlite3.node`)
5. `bun run dev`
6. Wait for the Electron window titled "Kilter Recovery Kit" to open
7. Tell them to install `adb` if they want to test the recovery flow (`winget install --id Google.PlatformTools` on Windows)

If they want to **try the catalog browser without doing a full recovery**, tell them to:

1. Get a copy of `com.auroraclimbing.kilterboard__base.apk` (~120 MB) from someone who has run a recovery
2. Drop it in `findings/android/SomeBundleName/raw/`
3. In the app, click **Boards** → **Pick recovery bundle** → choose `findings/android/SomeBundleName/`
4. The service will extract the embedded db.sqlite3 and board images on first open

## Things to NEVER do

- Never propose changes to code you haven't read.
- Never use `npm` / `yarn` / `pnpm` / `npx` — always `bun` / `bunx`.
- Never invoke `electron .` directly — always through `node scripts/run-electron.js`.
- Never relax `contextIsolation` / `nodeIntegration` / `sandbox` settings on the BrowserWindow.
- Never commit anything from `findings/` (it's gitignored — recovery bundles can be hundreds of MB and contain device-specific data).
- Never create README/CLAUDE/docs files unless the user asked. (This file exists because the user asked.)
- Never claim recovery is guaranteed. The product philosophy is *honest uncertainty*: we report what exists, what's accessible, what was parsed, and what remains impossible without stronger access.
- Never use emojis in source files unless asked.
- Never run `git push --force`, `git reset --hard`, `rm -rf <something the user cares about>` without explicit permission.

## Where to find more

| Document | Purpose |
|---|---|
| [README.md](README.md) | User-facing intro and quickstart |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Process model, module boundaries, data flow |
| [docs/FEASIBILITY.md](docs/FEASIBILITY.md) | What's recoverable on Android, why, and why not |
| [docs/STRATEGY_MATRIX.md](docs/STRATEGY_MATRIX.md) | Capability matrix → strategy gating |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phase plan, validation TODOs |
| [docs/ANDROID_STATUS.md](docs/ANDROID_STATUS.md) | Current state of Android Phase 1 — completed work, known gotchas, TODOs |
| [docs/IOS_ONBOARDING.md](docs/IOS_ONBOARDING.md) | Tour for the iOS Phase 2 developer (use this when triggered) |

When in doubt: read the docs first, read the code second, ask the user third.

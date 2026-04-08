# iOS Phase 2 — Developer Onboarding

> **AI agents reading this:** if you arrived here because the user said "I'm here to work on iOS" (or anything similar), this is the canonical tour. Walk the user through it interactively, section by section. Pause at the end of each section. Ask them if they want to dive deeper into a referenced module before moving on. Do **not** dump the entire document in one message — you are giving a tour, not a brain transplant.

> **Human reader:** Welcome. You're about to extend a working Android forensic recovery toolkit with an iOS pipeline. This document tells you what already exists, what you can reuse, what's deliberately *not* built, and where you'll be writing code. By the end, you should have a clear mental model of the project and a concrete starting point.

## Section 1 · What this project actually is

Kilter Recovery Kit is an Electron desktop app that recovers, parses, preserves, and **browses** local data left on a user's mobile device by the **Kilter Board** climbing app (and, opportunistically, the **Tension Board** app from the same publisher).

It is not a replacement for the Kilter Board app. It is a forensic tool that asks: *"What useful Kilter-related data still exists on this device, and how reliably can we extract it?"*

The product philosophy is **honest uncertainty**. Every recovery strategy declares what it requires, what it attempted, what it succeeded at, and what was impossible. The UI surfaces those facts to the user verbatim. We do not promise recovery — we report what exists.

**Read first:**
- [README.md](../README.md)
- [CLAUDE.md](../CLAUDE.md) (the agent operating manual at the repo root)

## Section 2 · The current state — Android is done

Phase 1 (Android) is feature-complete and validated against a real Pixel 7 running Android 16. Specifically:

- **Recovery flow:** detects USB-connected devices via `adb`, probes capabilities, runs 5 strategies, parses recovered artifacts, exports a self-contained evidence bundle.
- **Catalog browser:** opens the recovered SQLite database (extracted from the Kilter APK), precomputes 22 board configurations × 251k climbs in memory, and lets the user browse boards → climbs (with grade/search/sort filters) → climb detail (with the holds rendered as an SVG overlay on the actual board image).

What was discovered during Phase 1, in case it's useful for iOS:

- The Kilter Board APK ships a **190 MB SQLite database** in `assets/db.sqlite3` containing the entire public catalog: 344k climbs, 348k per-angle stats, 32k Instagram beta links. **This is the same database content that the iOS .ipa probably bundles too** — extracting it is equally valuable.
- The user's *personal* logbook (ascents, bids, circuits, walls, tags) lives in private app storage. On Android 11+ this requires root; on iOS the equivalent will be inside an iTunes/Finder backup or via libimobiledevice's afc service.
- Both `com.auroraclimbing.kilterboard` and `com.auroraclimbing.tensionboard2` exist. Phase 2 should treat both as in-scope recovery targets.

**Read [docs/ANDROID_STATUS.md](ANDROID_STATUS.md) for the full state of what's been built and validated.**

## Section 3 · The architecture you're inheriting

The architecture is intentionally platform-agnostic. The Android pipeline is one implementation of a general pattern. Your job for iOS is to write a parallel implementation following the same pattern, not to invent a new architecture.

The core concepts:

### 3.1 · Recovery Session

A `RecoverySession` ([electron/models/types.ts](../electron/models/types.ts)) is the unit of work. It has a device profile, a capability map, an array of strategy results, an array of artifact records, an array of parsed artifacts, a workspace directory, and a log file. Sessions are created when the user starts a scan and flushed to disk continuously.

iOS sessions will use the same `RecoverySession` shape. The `device.serial` field becomes the iOS UDID, the capabilities become iOS-specific (`backup.unencrypted`, `backup.encrypted`, `afc.read`, `house_arrest.read`, etc.), and the strategies + parsers + export bundle layout stay identical.

### 3.2 · Strategy Engine

A **Strategy** is a self-contained class that:

1. Declares the capabilities it requires (`requires: Capability[]`)
2. Receives a `StrategyContext` (the session, the device service, helpers to register artifacts, an emit-progress callback)
3. Returns a structured result with `attempted`, `artifactIds`, `confidence`, `notes`, `errors`

The **`StrategyEngine`** ([electron/services/recovery/StrategyEngine.ts](../electron/services/recovery/StrategyEngine.ts)) runs strategies in dependency order, gates each one on capability availability, catches and records errors per strategy (one failing strategy never breaks the session), and pipes resulting artifacts through the parser registry automatically.

**For iOS you will write strategies like:**

- `IosDeviceProfileStrategy` — `idevice_id -l`, `ideviceinfo`, capture model + iOS version + UDID
- `IosBackupDiscoveryStrategy` — locate existing iTunes/Finder backups in the standard locations (`~/Library/Application Support/MobileSync/Backup/` on macOS, `%APPDATA%\Apple\MobileSync\Backup\` on Windows)
- `IosBackupExtractionStrategy` — given a backup, parse `Manifest.db`, find files belonging to the Kilter app, extract them. Prompt user for password if encrypted.
- `IosLiveBackupStrategy` — trigger a fresh `idevicebackup2` against the connected device
- `IosAppContainerStrategy` (long shot) — `house_arrest` against a non-jailbroken device (only works for apps the developer flagged with the file-sharing entitlement; Kilter probably hasn't, but worth a probe)
- `IosIpaExtractionStrategy` — pull the Kilter `.ipa` from a backup if present, extract `db.sqlite3` from inside it (parallel to `ApkExtractStrategy`)

Each lives in `electron/services/recovery/strategies/ios/` (create the subdirectory). Each is registered in a new `electron/services/recovery/strategies/ios/index.ts` (parallel to the Android one). The engine doesn't care which platform a strategy targets — it just runs them in order.

### 3.3 · Parser Registry

The **`ParserRegistry`** ([electron/services/parsers/ParserRegistry.ts](../electron/services/parsers/ParserRegistry.ts)) is fully platform-agnostic. It probes each artifact's first 64 bytes against every registered parser and runs the highest-specificity match.

**You will need to add at least one new parser:**

- `PlistParser` — Apple binary property lists (magic `bplist00`). Most iOS app data is plist. Use `simple-plist` or `bplist-parser` from npm.

You can probably also reuse the existing parsers as-is:
- `SqliteParser` — iOS apps use SQLite extensively (it's literally Apple's recommended storage layer). Anything Kilter stores in `<container>/Library/Application Support/*.sqlite` will be picked up automatically.
- `JsonParser` — covers any JSON files.
- `BinaryProbeParser` — catch-all.

`SharedPrefsXmlParser` is Android-specific and won't fire on iOS files (correctly).

### 3.4 · IPC + Types

Renderer ↔ main communication is **strictly typed**. The flow is:

1. Define types in `electron/models/*.ts` (these are the only files imported by both main and renderer, and only as `import type`)
2. Add IPC channel handlers in `electron/ipc.ts`
3. Expose them via `contextBridge` in `electron/preload.ts`
4. Call them from React via `ipc().domain.method(...)`

For iOS you'll want a parallel `IosIpc` interface in a new `electron/models/iosTypes.ts`, and the renderer will call `window.kilter.ios.detect()` etc.

**Read these to see the pattern in action:**
- [electron/models/types.ts](../electron/models/types.ts)
- [electron/ipc.ts](../electron/ipc.ts)
- [electron/preload.ts](../electron/preload.ts)

### 3.5 · Catalog Service (the win you get for free)

The catalog browser ([electron/services/catalog/KilterCatalogService.ts](../electron/services/catalog/KilterCatalogService.ts)) reads a recovered `db.sqlite3` and exposes boards, climbs, holds, etc. **It is platform-agnostic.** Once your iOS extraction strategy produces the same `db.sqlite3` (which it should, because both the Android APK and the iOS IPA bundle the same canonical Kilter database), the existing catalog UI will just work.

Specifically, `KilterCatalogService.openFromBundle(bundleDir)` looks for a Kilter `.apk` in `<bundleDir>/raw/`. You will want to extend it to also look for a Kilter `.ipa` (or any zip containing `Payload/<appname>.app/db.sqlite3`). That's a ~20-line change once you have an iOS test bundle.

## Section 4 · Critical conventions you must follow

These are non-negotiable. Read [CLAUDE.md](../CLAUDE.md) for the full list. Highlights:

- **Bun, not npm.** `bun install`, `bun add`, `bun run dev`, `bunx`. Lockfile is `bun.lock`.
- **Native modules need rebuilding for Electron's Node ABI.** A `postinstall` hook handles `better-sqlite3` automatically. If you add another native module (e.g. for libimobiledevice bindings), add it to the postinstall.
- **`ELECTRON_RUN_AS_NODE` poisoning** — always launch Electron through `node scripts/run-electron.js`, never `electron .` directly.
- **Vite dev port is 8101**, not the default 5173. `electron/main.ts` and `vite.config.ts` must agree.
- **Renderer is sandboxed** (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`). Never relax these.
- **No `npm`, no emojis in source files, no docs unless asked.**

## Section 5 · The technical landscape of iOS data extraction

You are about to enter much more hostile territory than Android. Here's the honest reality:

### What's possible without jailbreak

| Path | Yields | Difficulty |
|---|---|---|
| **iTunes/Finder backups (unencrypted)** | Most app data, including SQLite databases | Easy — pure file parsing |
| **iTunes/Finder backups (encrypted)** | Same content, but everything inside is AES-encrypted with a key derived from the user's password | Medium — requires user password and a correct PBKDF2 implementation |
| **`idevicebackup2` (libimobiledevice)** | Same as iTunes backup, but triggerable from your code | Easy once libimobiledevice is bundled |
| **`afc` (libimobiledevice)** | Files in `/var/mobile/Media/` (the user's photo library and a few public dirs) | Easy but yields almost nothing app-specific |
| **`house_arrest` (libimobiledevice)** | Only the app's `Documents/` directory, and *only* if the developer set `UIFileSharingEnabled=YES` in Info.plist | Easy but Kilter almost certainly hasn't enabled file sharing — worth probing once and reporting honestly |
| **iCloud backup retrieval** | Same content as device backup, but stored in Apple's servers | Hard — requires Apple ID, 2FA, per-device key derivation, and is legally murky |
| **Sysdiagnose / log extraction** | System logs, possibly leaking app behavior | Medium yield, low value for forensic recovery |

### What's NOT possible without jailbreak

- Direct read of `/var/mobile/Containers/Data/Application/<UUID>/` (the app's private container) — same as Android's `/data/data/<pkg>/`
- Reading the iOS Keychain entries belonging to other apps
- Reading shared App Group containers belonging to other apps

### The realistic Phase 2 plan

Mirror Phase 1's honesty:

1. **Detect the device** (UDID, model, iOS version) — high confidence, always works
2. **Discover existing backups on disk** — check the standard MobileSync paths
3. **Trigger a fresh backup** if none exists — give the user the option, warn them it'll take time
4. **Decrypt if needed** — prompt for password, use AES-CBC + correct key derivation
5. **Parse Manifest.db** — find files belonging to `com.auroraclimbing.kilterboard`
6. **Extract those files** to the session workspace as artifacts
7. **Send them through the existing parser registry** — SQLite, plist, JSON
8. **The catalog browser auto-picks up the recovered db.sqlite3** — you reuse all the catalog UI for free

The **honest negative cases:**

- If the user has never backed up their iPhone, there's nothing to recover. Tell them.
- If `house_arrest` against the Kilter app fails (it will), report it as `skipped: missing capability house_arrest.<pkg>` and explain why.
- If the backup is encrypted and the user doesn't know the password, there's nothing to recover. Tell them.

## Section 6 · Where you'll be writing code

```
electron/
  models/
    iosTypes.ts                      ← NEW: IosDevice, IosBackup, IosCapability, IosIpc
  services/
    ios/                             ← NEW: parallel to electron/services/adb/
      IosBinary.ts                   ← libimobiledevice binary discovery
      IosService.ts                  ← idevice_id, ideviceinfo, idevicebackup2 wrapper
      backup/
        ManifestParser.ts            ← parses Manifest.db (SQLite)
        BackupDecryptor.ts           ← AES-CBC + key derivation for encrypted backups
        BackupFileResolver.ts        ← Manifest.db → real file paths inside the backup
    recovery/
      strategies/
        ios/                         ← NEW: parallel to .../strategies/(android files)
          IosDeviceProfileStrategy.ts
          IosBackupDiscoveryStrategy.ts
          IosBackupExtractionStrategy.ts
          IosLiveBackupStrategy.ts
          IosHouseArrestStrategy.ts  ← honest negative case
          IpaExtractStrategy.ts      ← parallel to ApkExtractStrategy
          index.ts
    parsers/
      PlistParser.ts                 ← NEW: bplist + xml plist
    catalog/
      KilterCatalogService.ts        ← extend to also accept .ipa files
  ipc.ts                             ← register kilter.ios.* channels
  preload.ts                         ← expose kilter.ios.*

src/
  screens/
    IosWelcomeScreen.tsx             ← NEW: replace IosComingSoonScreen content
    IosConnectScreen.tsx             ← NEW
    IosDeviceScanScreen.tsx          ← NEW
    IosBackupScreen.tsx              ← NEW: discover/trigger/decrypt
    IosKilterDetectionScreen.tsx     ← NEW
    IosStrategiesScreen.tsx          ← NEW (or share the Android one)
    IosFindingsScreen.tsx            ← NEW (or share)
    IosExportScreen.tsx              ← NEW (or share)
  App.tsx                            ← wire the new screens into the iOS branch
```

The catalog screens (`BoardsScreen`, `ClimbsScreen`, `ClimbDetailScreen`) are platform-agnostic and **do not need to be duplicated**. Once your iOS extraction strategy produces a recovery bundle with a Kilter `.ipa` (or already-extracted `db.sqlite3`) inside, the user picks the bundle in the existing Boards screen and everything works.

## Section 7 · Recommended dependencies

You will probably want:

- **`bplist-parser`** or **`simple-plist`** — for reading binary property lists. Lightweight, no native code.
- **`node-libimobiledevice`** or shelling out to the **libimobiledevice** CLI tools (`idevice_id`, `ideviceinfo`, `idevicebackup2`). The CLI shell-out path is more reliable cross-platform; the bindings are nicer but break more easily.
- **`crypto`** (Node built-in) — for AES-CBC + PBKDF2 when decrypting encrypted backups.
- **`adm-zip`** or shelling out to `unzip` — for extracting `.ipa` contents (an .ipa is just a renamed .zip). The Android side already shells out to `unzip` for APKs, so the same approach works.

**Do not** add Electron-specific dependencies if you can avoid them. The principle is: services in `electron/services/` should be plain Node code that could in theory run outside Electron. This is what makes the test surface manageable.

## Section 8 · Your first commit

Don't try to build everything at once. Start with the equivalent of "ConnectScreen for Android":

1. Create `electron/services/ios/IosBinary.ts` that finds `idevice_id` on PATH or in common install locations (Homebrew on macOS, MSYS2 on Windows)
2. Create `electron/services/ios/IosService.ts` with one method: `listDevices()` that runs `idevice_id -l` and parses the UDIDs
3. Add an IPC handler `ios.listDevices`
4. Replace `IosComingSoonScreen.tsx` with a real `IosConnectScreen.tsx` that shows the detected libimobiledevice binary and lets the user click "Refresh"
5. Test: plug in an iPhone, click Refresh, see the UDID

If you can ship that one round-trip, you have proven the entire stack works for iOS. Everything else is just adding strategies + parsers.

## Section 9 · How to get help

When in doubt:

1. **Read the corresponding Android implementation.** Every iOS module has a structural twin on the Android side. If you're writing `IosBinary.ts`, read [electron/services/adb/AdbBinary.ts](../electron/services/adb/AdbBinary.ts) first.
2. **Read [docs/ARCHITECTURE.md](ARCHITECTURE.md)** for the high-level patterns.
3. **Read [docs/FEASIBILITY.md](FEASIBILITY.md)** to see how Phase 1 documented its known limits — your iOS feasibility doc should follow the same shape.
4. **Ask the agent** — Claude (or whichever agent is paired with you) has read [CLAUDE.md](../CLAUDE.md) and knows the conventions. Lean on it.

## Section 10 · A note on tone

This project values **honest negative results**. When you write a strategy that doesn't work on a real device, **say so explicitly in the strategy result**. Don't fake success. Don't hide errors. Don't claim "recovery" when what you have is "the user's photo library that the app happens to write into".

The Android side has multiple strategies that *correctly* report `skipped` or `failed` with documented reasons. That's a feature, not a bug. The user knows exactly what was tried, what worked, and what's impossible without stronger access. Inherit that posture.

---

**Welcome to the team. Now let's go pull some data off an iPhone.**

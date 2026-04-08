# Android — Phase 1 Status

A snapshot of what is built, what was validated against a real device, and what remains TODO. This document is updated as work progresses; it is the source of truth for "what's actually shipped on the Android side."

## TL;DR

**Android Phase 1 is feature-complete.** A user can plug in an Android device, run a full recovery session, browse the recovered Kilter catalog inside the app, and export everything as a self-contained evidence bundle. Validated end-to-end against a Google Pixel 7 running Android 16 (SDK 36).

## What's built

### Recovery pipeline

| Component | Status | Notes |
|---|---|---|
| ADB binary discovery | ✅ Done | Searches setting → `ADB_PATH` env → common SDK locations (incl. WinGet's `Google.PlatformTools` install) → PATH |
| Device enumeration | ✅ Done | Parses `adb devices -l`, surfaces auth state |
| Device profile capture | ✅ Done | `getprop` for model, manufacturer, brand, Android version, SDK level, ABI, build fingerprint |
| Capability probing | ✅ Done | Live probes for `adb.shell`, `pm.list`, `pm.path`, `dumpsys.package`, `sdcard.read`, `mediastore.query`, `root` (presence of su) |
| Strategy engine | ✅ Done | Capability-gated; one failing strategy never breaks the session |
| `device.profile` strategy | ✅ Done | Always-first |
| `package.detection` strategy | ✅ Done | Known ids + fuzzy hints, parses `dumpsys package` for `versionName`, `flags`, install/update times |
| `apk.extract` strategy | ✅ Done | `pm path` + `adb pull` for every detected Kilter package |
| `dumpsys.intel` strategy | ✅ Done | Captures full dumpsys text + attempts `du -sh` (will be permission-denied without root, recorded honestly) |
| `accessible.storage.scan` strategy | ✅ Done | Two-pass: package-scoped targeted scan first, then bounded broad scan with `-maxdepth 4` per root |
| Parser registry | ✅ Done | First-byte probe + specificity ranking |
| `SqliteParser` | ✅ Done | Schema dump + row sampling + heuristic table classification |
| `JsonParser` | ✅ Done | Bounded JSON loader with structural preview |
| `SharedPrefsXmlParser` | ✅ Done | Regex-based decoder (no XML lib) |
| `BinaryProbeParser` | ✅ Done | Catch-all magic byte sniffer |
| Recovery session store | ✅ Done | Per-session workspace dir, persisted `session.json` |
| Export bundle | ✅ Done | `raw/`, `parsed/`, `session.json`, `report.json`, `report.md`, `logs.ndjson` |
| Structured logging (NDJSON) | ✅ Done | File + ring buffer + listener fan-out → real-time Diagnostics screen |

### Catalog browser

| Component | Status | Notes |
|---|---|---|
| `KilterCatalogService` | ✅ Done | Read-only better-sqlite3 over the recovered SQLite |
| Bundle picker | ✅ Done | User chooses any recovery bundle directory; service finds the APK inside `raw/` |
| One-time extraction | ✅ Done | Extracts `assets/db.sqlite3` (190 MB) and `assets/img/product_sizes_layouts_sets/*.png` to `<bundleDir>/_catalog/` on first open |
| Precompute | ✅ Done | Parses 251k climbs once, buckets into 22 board configurations with **real set-aware** counts (not bbox approximations), loads all 22 board images to base64 in parallel |
| `BoardsScreen` | ✅ Done | Grid of cards, sorted by popularity, hides empty configs |
| `ClimbsScreen` | ✅ Done | Search by name + grade filter dropdown + sort by popularity/quality/difficulty/newest/name + paginated 100/page |
| `ClimbDetailScreen` | ✅ Done | SVG overlay with halo+glow, per-angle stats table, Instagram beta links, raw frames |
| Auto-render holds | ✅ Done | Parses `frames` string `p<placement>r<role>` → resolves to `(x, y)` + role color from `placement_roles.screen_color` |

### UI shell

| Component | Status | Notes |
|---|---|---|
| Sectioned sidebar | ✅ Done | Top-level branches: **Android** (Recovery + Catalog + Tools) and **iOS** (Coming soon) |
| Auto-expand active branch | ✅ Done | When the active screen changes, its branch expands automatically |
| Window resize | ✅ Done | Explicit `resizable: true` + `setMinimumSize` after `ready-to-show` (works around a Windows 11 + Electron bug) |
| Auto-reopen in dev | ✅ Done | Closing the window in dev re-opens it instead of tearing down `concurrently` |

## Validated facts (Pixel 7 / Android 16 / SDK 36)

These are the things we *know* because we ran them against a real device, not what we assumed.

### Kilter packages on disk

| Package | Version | First installed | `allowBackup` | `debuggable` |
|---|---|---|---|---|
| `com.auroraclimbing.kilterboard` | **3.9.18** (versionCode 230) | 2024-02-06 | **`true`** ⚠ | `false` |
| `com.auroraclimbing.tensionboard2` | 5.0.6 (versionCode 230) | 2023-05-08 | **`true`** ⚠ | `false` |

The `allowBackup=true` is *unusual* for modern apps and means `adb backup` would theoretically work — except, see the `adb backup` row below.

### What we successfully extracted

- ✅ **Both APKs** (~120 MB and ~71 MB base.apk respectively, plus 3 split APKs each)
- ✅ **`dumpsys package` text dumps** for both packages (rich forensic context)
- ✅ **`/sdcard/Android/data/com.auroraclimbing.kilterboard/cache/diskcache/map_cache.db`** + `.db-shm` + `.db-wal` (3.9 MB total — turned out to be Google Maps tile cache, not user data, but the *fact* we could read it confirms targeted scoped-storage scans work on this device)
- ✅ **`assets/db.sqlite3`** extracted from inside the APK (190 MB) — see "What's in the APK" below

### What we tried and confirmed dead

| Recovery path | Result | Why |
|---|---|---|
| `adb shell run-as com.auroraclimbing.kilterboard` | ❌ `package not debuggable` | Production build, expected |
| `adb backup -f kilter.ab -noapk com.auroraclimbing.kilterboard` | ❌ Returns 47-byte empty payload, exit 0, no dialog shown | Android 12+ silently disabled the backup UI even when `allowBackup=true` |
| Direct read of `/data/data/com.auroraclimbing.kilterboard/databases/` | ❌ Permission denied | Standard Android sandboxing |
| Direct read of `/sdcard/Android/data/com.auroraclimbing.tensionboard2/` | ❌ Returns nothing — directory empty or inaccessible | Tension Board doesn't write to scoped external storage |

**The only path to the user's personal logbook (`ascents`, `bids`, `circuits`, `walls`, `tags`) is root.** This is documented in [FEASIBILITY.md](FEASIBILITY.md) and is intentionally out of scope for Phase 1.

### What's in the APK (the real win)

The 190 MB `assets/db.sqlite3` shipped inside `com.auroraclimbing.kilterboard__base.apk` is the **complete public Kilter catalog snapshot**. Schema:

```
android_metadata             1 row
attempts                    38 rows   (Flash, 2 tries, ..., lookup table)
beta_links              32,139 rows   ← 32k Instagram beta videos
bids                         0 rows   (user-specific, empty in shipped APK)
circuits                     0 rows   (user-specific)
circuits_climbs              0 rows
climb_cache_fields     208,457 rows   (per-climb popularity/quality/difficulty cache)
climb_random_positions       0 rows
climb_stats            348,028 rows   ← per-climb-per-angle stats with FA usernames
climbs                 344,504 rows   ← THE WORLD'S KILTER CATALOG
difficulty_grades           39 rows   (V-grade ↔ font ↔ YDS lookup)
holes                    3,294 rows   (every physical hole on every board)
kits                       100 rows   (recognized Bluetooth kit serial numbers)
layouts                      8 rows
leds                     7,828 rows   (LED → hole mapping for the firmware)
placement_roles             30 rows   (start/middle/finish/foot per product)
placements               3,773 rows   (which holes carry which set on which layout)
product_sizes               22 rows   (every physical board size)
product_sizes_layouts_sets  41 rows   (the 41 valid board configurations)
products                     7 rows   (the 7 board lines)
products_angles             56 rows
sets                        11 rows
shared_syncs                17 rows
sqlite_stat1                24 rows
tags                         0 rows   (user-specific)
user_permissions             0 rows
user_syncs                   0 rows
users                        0 rows   (user-specific)
walls                        0 rows   (user-specific — your gym setups would live here)
walls_sets                   0 rows
```

**This is the canonical public catalog.** The empty user-specific tables (`users`, `walls`, `ascents`, `bids`, `circuits`, `tags`) are populated by the running app from the user's account; the snapshot in the APK is fresh.

**Key insight:** the `frames` column on `climbs` is a string of `p<placement_id>r<role_id>` pairs. Combined with `placements → holes (x, y)` and `placement_roles.screen_color`, every one of the 344,504 climbs can be rendered exactly as the official app renders them.

### Bugs found and fixed

These are the real ones that came up during Phase 1 development. Documented here so the next dev (you, future me, or the iOS dev) doesn't repeat them.

| Bug | Symptom | Root cause | Fix |
|---|---|---|---|
| `ELECTRON_RUN_AS_NODE=1` poisoning | `app.isPackaged` returned `undefined`, main crashed instantly | The user's environment had `ELECTRON_RUN_AS_NODE=1` set globally; with that, `electron .` runs as plain Node | Created `scripts/run-electron.js` that explicitly **deletes** the env var before spawning Electron. All scripts route through it. |
| Wrong dev port loaded | Window opened showing a totally different app (CuidArte) | Vite was on 8101 but `electron/main.ts` still hard-coded `localhost:5173`, and another local app was using 5173 | Hard-coded `8101` in `main.ts` |
| `better-sqlite3` ABI mismatch | `NODE_MODULE_VERSION 127 vs 128` at runtime | bun installed it against system Node 22 (ABI 127) but Electron 32 ships Node 20 (ABI 128) | Added `electron-rebuild -f -w better-sqlite3` postinstall hook in `package.json` |
| Window not resizable on Windows 11 | User could maximize but not drag-resize on first open | Combination of `show: false` + `ready-to-show` left the WM caching a "fixed size" hint | Explicit `resizable/maximizable/minimizable/fullscreenable: true` + `setResizable(true)` + `setMinimumSize` re-applied after show |
| Boards count showed bbox-only approximation (wrong) | Bolt Ons and Screw Ons of the same physical size showed identical climb counts | The first count implementation only filtered by bbox + layout; the set membership check was skipped at count time | Rewrote `precomputeBoardsAndClimbs()` to walk all 251k climbs once at open time, parse their `frames`, and bucket each climb into every config whose `(layout, set, bbox)` actually matches |
| BoardsScreen UI froze for several seconds | Sequential `for...await` loop making 22 IPC calls, blocking the renderer | Lazy-load images one at a time | Backend now precomputes and caches all 22 base64 images in parallel at `openFromBundle` time; renderer just reads from cache |
| Hold rings invisible in ClimbDetail (first attempt) | Holds rendered with valid coordinates but no visible color | The `placement_roles.screen_color` column stores hex *without* the `#` prefix (e.g. `"00DD00"`), which is invalid CSS | Prepend `#` when reading the color in `KilterCatalogService` |
| Board image data URL blocked by CSP | Board images failed to render in `<img>` tags | The `index.html` meta CSP had `default-src 'self'` which blocks `data:` for images | Added `img-src 'self' data:` to the CSP |
| `find` timed out scanning `/sdcard` | First storage scan attempt returned 0 files after 60 seconds because it was traversing photo libraries 20+ levels deep | Single big `find` command across all roots with no depth limit | Split into two passes: targeted package-scoped scan first, then per-root broad scan with `-maxdepth 4` and 45s timeout per root |

## Validation TODOs

These were called out in [FEASIBILITY.md](FEASIBILITY.md) and have been **resolved** during Phase 1:

- [x] Confirm the legacy Kilter Board package id → `com.auroraclimbing.kilterboard`
- [x] Confirm `allowBackup` and `debuggable` flags → `true` and `false`
- [x] Capture sample artifacts from a device that still has the app → done, 13 artifacts pulled
- [x] Test `adb backup` end-to-end on a modern Android device → confirmed dead on Android 16
- [x] Catalogue what the app writes to `/sdcard/Android/data/<pkg>/` → only Google Maps tile cache

## Open TODOs

### Recovery side (Android)

- [ ] **`runas.extract` strategy** — implement it as an honest `skipped` for production builds (`debuggable=false`), but write the code so if anyone ever tests against a debuggable build it works
- [ ] **`mediastore.query` strategy** — we have a capability probe for it but no full strategy. Could surface app-written media even after uninstall
- [ ] **`logcat.passive` strategy** — capture recent logcat entries tagged with the package, useful if the app is currently running and leaking schema info
- [ ] **`root.full.extract` strategy** — Phase 3, gated behind `Capability.root`. Would yield the user's `walls`, `ascents`, `bids`, `circuits`, `tags` from `/data/data/.../databases/`
- [ ] Tighten `KNOWN_KILTER_PACKAGES` in `electron/models/kilterPackages.ts` — drop the unverified guesses, keep only the validated ids
- [ ] APK parser: open the APK as a ZIP, list `assets/`, register interesting files as child artifacts, and pipe them back into the parser registry recursively. Right now we treat the APK as an opaque binary.

### Catalog side

- [ ] **Favorites / starred climbs** — let the user mark climbs locally and persist to a sidecar JSON next to the bundle
- [ ] **Gym presets** — let the user save "this is my gym" and have a one-click filter
- [ ] **Multi-board comparison** — pick 2 boards, see the diff in available climbs
- [ ] **Virtualized list** for ClimbsScreen — currently fine at 100 per page but if we ever load >5k items into the DOM at once it'll get slow
- [ ] **Render multi-frame climbs** as an animated sequence (currently we only render the first frame for `frames_count > 1`)
- [ ] **APK detection improvements** — accept Tension Board APKs too, not just Kilter Board. The catalog service hardcodes "kilterboard" in its file search.

### UX polish

- [ ] Keyboard shortcuts (esp. `Esc` to back-navigate)
- [ ] Light theme toggle (currently dark only)
- [ ] Persist last-opened bundle across app restarts
- [ ] Empty-state illustrations on screens that have data dependencies (Catalog, Findings)

### Documentation

- [x] [README.md](../README.md), [docs/ARCHITECTURE.md](ARCHITECTURE.md), [docs/FEASIBILITY.md](FEASIBILITY.md), [docs/STRATEGY_MATRIX.md](STRATEGY_MATRIX.md), [docs/ROADMAP.md](ROADMAP.md)
- [x] [CLAUDE.md](../CLAUDE.md) — agent operating manual
- [x] [docs/IOS_ONBOARDING.md](IOS_ONBOARDING.md) — tour for the iOS Phase 2 dev
- [x] [docs/ANDROID_STATUS.md](ANDROID_STATUS.md) — this file

## Test bundle

A small reference bundle suitable for trying the catalog browser without doing a full recovery is in [findings/android/sample/](../findings/android/sample/) (see the README in that directory). It contains *only* the assets needed to demonstrate the catalog browser, not real device-specific data.

To use it:

1. Clone the repo and `bun install`
2. `bun run dev`
3. Click **Boards** → **Pick recovery bundle…**
4. Choose `findings/android/sample/`
5. Browse boards → climbs → click any climb to see the rendered detail

If `findings/android/sample/` is empty in your clone, that means the maintainer chose not to ship the sample (because of size or copyright concerns). In that case, you'll need to do a real recovery against an Android device with Kilter Board installed.

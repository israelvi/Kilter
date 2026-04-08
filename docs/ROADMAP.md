# Roadmap

## Phase 1 — Recovery Toolkit MVP (this phase)

**Goal**: a desktop app that detects an Android device, runs structured recovery strategies, parses what it finds, and exports an honest evidence bundle.

### Phase 1 deliverables

- [x] Architecture, feasibility, strategy matrix documents
- [x] Electron + TypeScript + React project scaffold
- [x] Real ADB binary detection and version reporting
- [x] Real `adb devices` listing with auth state
- [x] Device profile gathering via `getprop`
- [x] Strategy engine with capability gating and error capture
- [x] Implemented strategies: `device.profile`, `package.detection`, `apk.extract`, `accessible.storage.scan`, `dumpsys.intel`
- [x] Parser registry with SQLite, JSON, XML SharedPrefs, generic binary parsers
- [x] RecoverySession model with provenance, hashes, confidence scores
- [x] Eight UI screens wired to real backend
- [x] Structured NDJSON logger + Diagnostics screen
- [x] Evidence bundle export (`session.json`, `report.md`, `raw/`, `parsed/`, `logs.ndjson`)

### Phase 1 TODOs that need real-device validation

- [ ] Confirm legacy Kilter Board package id(s) — fill `KNOWN_KILTER_PACKAGES`
- [ ] Confirm `allowBackup` and `debuggable` flags from a real APK
- [ ] Capture sample artifacts from a device that still has the app
- [ ] Test `adb backup` end-to-end on Android 9
- [ ] Catalogue any files the app writes to `/sdcard/` or `Android/data/<pkg>/`
- [ ] Tighten name + extension heuristics based on real findings
- [ ] Build the schema-aware parser once we see real databases

## Phase 2 — Schema-aware parsing

Once we have real artifacts:

- Build typed parsers for each confirmed Kilter file type
- Map raw rows → normalized entities (`RecoveredUser`, `RecoveredProblem`, `RecoveredAscent`, `RecoveredBoardLayout`)
- Confidence scoring based on schema match completeness
- Cross-artifact joins (e.g. ascent → problem → board)

## Phase 3 — Advanced (rooted) mode

- `root.full.extract` strategy
- WebView storage parser (Cookies, Local Storage, IndexedDB)
- System account database inspection

## Phase 4 — Open archive upload (separate product)

- Define an open data schema for community archive
- Optional, opt-in upload of normalized data
- Out of scope for this repository

## Explicitly **out of scope** for Phase 1

- iOS support
- BLE board control
- Route publishing / social features
- A replacement Kilter Board client
- Cloud sync
- Community platform

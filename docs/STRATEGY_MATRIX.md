# Recovery Strategy Matrix

Each strategy declares the **capabilities** it requires. The Strategy Engine evaluates the device's capability map first, then runs only the strategies whose requirements are satisfied. A strategy that runs but finds nothing is recorded as `success: true, artifacts: []` — a strategy that cannot run is recorded as `skipped: true` with a reason. Both states are honest data.

## Capability vocabulary

| Capability | Meaning |
|---|---|
| `adb.connected` | A device is connected and authorized |
| `adb.shell` | Shell commands work |
| `adb.pull` | `adb pull` works |
| `pm.list` | `pm list packages` works |
| `dumpsys.package` | `dumpsys package <pkg>` works |
| `pm.path` | `pm path <pkg>` returns a path (i.e. APK pull is possible) |
| `runas.<pkg>` | `run-as <pkg>` works (app installed AND debuggable) |
| `backup.api` | `adb backup` is supported on this Android version (≤ 11) |
| `backup.allowed.<pkg>` | The package's manifest does not set `allowBackup=false` |
| `sdcard.read` | `/sdcard` is freely readable via `adb shell` |
| `appdata.legacy.read` | `/sdcard/Android/data/<pkg>/` is freely readable (Android ≤ 10) |
| `mediastore.query` | `content query --uri content://media/external/file` works |
| `root` | Device is rooted (future advanced mode) |

## Strategy ↔ capability matrix

| Strategy | Requires | Yields | Confidence | Notes |
|---|---|---|---|---|
| `device.profile` | `adb.connected`, `adb.shell` | DeviceProfile (model, Android version, SDK, fingerprint, serial) | high | Always runs first |
| `package.detection` | `pm.list` | Whether any known Kilter package id is present, with version + flags | high | Reads `dumpsys package <pkg>` for `flags`, `versionName`, `firstInstallTime`, `lastUpdateTime` |
| `apk.extract` | `pm.path`, `adb.pull` | The APK file(s) on disk | high | Always works for non-system apps. Lets us verify `allowBackup`, `debuggable`, signing certs |
| `accessible.storage.scan` | `sdcard.read` | Candidate files on `/sdcard` matching name + extension heuristics | medium | False positives possible — parser layer disambiguates |
| `app.external.scan` | `appdata.legacy.read` | Files under `/sdcard/Android/data/<pkg>/` and `/sdcard/Android/media/<pkg>/` | medium-high | Restricted on Android 11+ — strategy detects and reports |
| `mediastore.query` | `mediastore.query` | MediaStore rows referencing the package or its known media paths | medium | Surfaces files even after uninstall sometimes |
| `dumpsys.intel` | `dumpsys.package` | Indirect evidence — install/update times, last use, data dir size | low-medium | Useful even when nothing else is recoverable |
| `adb.backup` | `backup.api`, `backup.allowed.<pkg>` | `.ab` archive of private app data | high (when it works) | Almost always blocked on modern devices; reports honestly |
| `runas.extract` | `runas.<pkg>` | Full read of `/data/data/<pkg>/` | high | Only works for debuggable builds — production Kilter is unlikely to qualify |
| `logcat.passive` | `adb.shell` | Recent logcat entries tagged with the app | low | Only useful if app is currently running |
| `root.full.extract` | `root` | Full `/data/data/<pkg>/` extraction | high | **Future advanced mode — not implemented in Phase 1** |

## Device-state outcome map

| Device state | Strategies that fire | Best-case yield |
|---|---|---|
| Android 6–10, app installed, `allowBackup=true` (unlikely) | All except `runas.extract` (unless debuggable) and `root.*` | Full app data via `adb backup` + APK + sdcard scan |
| Android 6–10, app installed, `allowBackup=false`, not debuggable | `device.profile`, `package.detection`, `apk.extract`, `accessible.storage.scan`, `app.external.scan`, `mediastore.query`, `dumpsys.intel` | APK + whatever leaked to public storage + indirect evidence |
| Android 11+, app installed, `allowBackup=false`, not debuggable | Same as above minus `app.external.scan` (restricted) and `adb.backup` (deprecated) | APK + sdcard scan + MediaStore + dumpsys |
| App **uninstalled**, leftovers possible | `device.profile`, `accessible.storage.scan`, `mediastore.query`, leftover-directory scan | Whatever survived uninstall in `/sdcard/` and MediaStore |
| Rooted device | All of the above + `root.full.extract` (future) | Full private data |
| USB debugging not authorized | `device.profile` only (limited) | Connection metadata; user prompted to authorize |

## Adding a strategy

1. Create `electron/services/recovery/strategies/MyStrategy.ts` implementing `RecoveryStrategy`.
2. Declare `id`, `requires`, `description`, `run(ctx)`.
3. Register in `electron/services/recovery/strategies/index.ts`.
4. Add a row to this document.

The engine handles ordering, dependency-gating, error capture, and reporting.

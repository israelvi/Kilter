# Feasibility Analysis

## Question

Can useful Kilter Board user data still be recovered from Android devices that have, or once had, the legacy app installed — without requiring root, and with the user's explicit consent?

## What we know

- The legacy Kilter Board Android app stored a non-trivial amount of local data (a user screenshot showed ~200 MB of app data plus cache still resident).
- 200 MB is far more than a thin client would need for code + assets alone. It is consistent with cached API responses, downloaded board imagery, sqlite or realm databases, and possibly user-generated content.
- The Android security model isolates per-app private data under `/data/data/<pkg>/` and (since Android 4.4) the per-user `/data/user/<id>/<pkg>/`. Without root, that directory is **not** readable by `adb shell` as the `shell` user.
- However, several real exfiltration paths still exist on non-rooted devices, summarized below.

## What we assume (and must validate)

| # | Assumption | How to validate |
|---|---|---|
| 1 | The legacy package id is stable and discoverable via `pm list packages` | Run on a real device with the app installed; capture exact id and store in `KNOWN_KILTER_PACKAGES` |
| 2 | The app's APK is pullable via `adb shell pm path <pkg>` then `adb pull` | Standard Android behavior for non-system apps; should work without root |
| 3 | At least some user-relevant artifacts live on shared/external storage (`/sdcard/`, `Android/data/<pkg>/`, `Android/media/<pkg>/`) and remain accessible via MTP / `adb shell run-as` is **not** required for them | Documented Android behavior up to API 29; restricted from API 30+ via Scoped Storage but legacy install grandfathering may apply |
| 4 | `adb shell run-as <pkg>` works against the app **only if** the app is installed and marked debuggable. The legacy Kilter app is almost certainly **not** debuggable in production builds. | Verify with `aapt dump badging` or `dumpsys package <pkg>` `flags=[ … DEBUGGABLE]` |
| 5 | `adb backup` may produce an `.ab` file containing the app's private data, but only if the app's manifest does not set `android:allowBackup="false"` and the device is Android 6–11. Deprecated in Android 12+ | Verify against the actual APK manifest |
| 6 | Some leftover artifacts may exist in publicly readable locations even after uninstall (`Android/media/<pkg>/`, `Pictures/`, `Download/`, leftover MediaStore entries, app cache that survived uninstall) | Heuristic scan with name + extension matching |
| 7 | A Google account that backed the device up via Android Auto Backup may hold the app's data on Google's servers; restoring requires reinstalling the same package id from Play, which is impossible if the listing is gone | Out of scope for this phase, but document as a future avenue |

## What is realistically possible without root

| Path | Possible? | Yields |
|---|---|---|
| `adb devices` / device profile via `getprop` | ✅ Yes | Model, Android version, SDK, build fingerprint, serial — always available |
| `pm list packages` / `dumpsys package <pkg>` | ✅ Yes | Whether the package is installed, version, install time, signing certs, debuggable flag, allowBackup flag |
| Pull APK via `pm path` + `adb pull` | ✅ Yes (always, for non-system apps) | The APK itself — version, manifest, assets, resources, and any data the developer foolishly bundled |
| Read `/data/data/<pkg>/` directly | ❌ No without root | (would yield databases, shared prefs, cached payloads) |
| `adb shell run-as <pkg>` | ⚠️ Only if app is debuggable | Same as above, but legacy production build is almost certainly not debuggable |
| `adb backup -f out.ab <pkg>` | ⚠️ Android 6–11 only, only if `allowBackup=true` | Tar of the app's private data inside the proprietary `.ab` wrapper |
| Scan `/sdcard/` (`/storage/emulated/0/`) for Kilter-named files | ✅ Yes | Anything the app wrote to public storage: screenshots, exports, downloaded board images, logs, sometimes cached JSON |
| Scan `/sdcard/Android/data/<pkg>/` | ⚠️ Pre-Android 11 freely; Android 11+ via MTP only | App-scoped external storage — frequently holds caches, downloaded media, occasionally databases |
| Scan `/sdcard/Android/media/<pkg>/` | ✅ Generally yes | Media files the app considered shareable |
| MediaStore query (`content://media`) | ✅ Yes via `adb shell content query` | Surfaces media that has been indexed even if the file path moved or the app was uninstalled |
| `dumpsys diskstats`, `dumpsys package`, `dumpsys usagestats` | ✅ Yes | Indirect evidence of app footprint and last use |
| `logcat -d` filtered by tag | ✅ Yes if app is currently running | Diagnostics, sometimes leaks of state. Useful for the parser to learn schemas if app is launchable |
| iCloud-style off-device backup | N/A | Out of scope (Android only, on-device only this phase) |

## What is realistically possible *with* root (future "advanced mode")

- Full read of `/data/data/<pkg>/` — databases, shared prefs, cached payloads.
- Parsing of `webview/` and `app_webview/` storage (Cookies, Local Storage, IndexedDB).
- Inspection of `/data/system_ce/<user>/accounts_ce.db` for any account-system traces.
- This phase **does not** implement rooted access, but the strategy interface reserves a `requires: ['root']` capability so a future strategy can be added without architectural changes.

## Android version constraints that shape the product

| Android version | API | Impact on recovery |
|---|---|---|
| 4.4–5.1 | 19–22 | Most permissive. Full `/sdcard` reads, `adb backup` works broadly. Vanishingly rare in 2026. |
| 6–8 | 23–27 | `adb backup` works for apps with `allowBackup=true`. `/sdcard` largely open. |
| 9–10 | 28–29 | `adb backup` still functional but Google began restricting it. Scoped Storage in preview. |
| 11 | 30 | Scoped Storage enforced. `/sdcard/Android/data/<pkg>` no longer freely readable via `adb shell` as `shell` user — must use MTP / `content://` providers / `cmd appops`. |
| 12+ | 31+ | `adb backup` deprecated and largely useless. Tighter restrictions on `Android/data` access. |
| 13+ | 33+ | Notification permission, photo picker, more restrictions. |

The product **must** detect Android version up front and choose strategies accordingly.

## Risks

- **R1: Schema is unknown.** We do not yet have a confirmed copy of the Kilter Board APK or any sample database. The parser layer must handle unknown schemas gracefully and rely on heuristic classification.
- **R2: `allowBackup=false` likely.** Most modern climbing apps disable backup. If true, `adb backup` is dead on arrival and we must say so honestly in the strategy result.
- **R3: Scoped Storage on the user's device.** If the user is on Android 11+, `Android/data/<pkg>/` access via `adb shell` will require MTP or `content://` workarounds. Strategies must detect and report this rather than silently failing.
- **R4: False positives in name-based scans.** "kilter" is a real English word. Name matching alone is not enough; we combine with extension, magic bytes, and (where possible) parent directory.
- **R5: User trust.** A recovery toolkit that touches storage and runs `adb` commands must be transparent. Every command is logged and visible in Diagnostics.
- **R6: Legal/ethical.** The product is scoped to **the user's own device with explicit consent**. The UI must say so in plain language and never offer remote-device or social-engineering features.

## What we still need to validate (TODO)

1. Obtain an actual legacy Kilter Board APK and confirm the package id, the `allowBackup` flag, the `debuggable` flag, and the on-disk file layout it leaves under `/sdcard/Android/data/<pkg>/`.
2. Confirm whether the app uses SQLite, Realm, or a custom format for its primary store.
3. Confirm whether any user-meaningful files (e.g. ascent logs) are written to public storage.
4. Confirm Android version distribution among likely users.
5. Test `adb backup` behavior against the real APK on an Android 9 device.
6. Catalogue MediaStore artifacts the app may have left behind after uninstall.

These are tracked in [ROADMAP.md](ROADMAP.md).

## Bottom line

Without root, and against a non-debuggable, `allowBackup=false` modern build, the **guaranteed** recoveries are:

- Device profile and forensic context
- APK itself (always pullable)
- Anything the app wrote to public storage (potentially zero, potentially gold)
- MediaStore and `dumpsys` indirect evidence

The **possible but conditional** recoveries are:

- `adb backup` payload (Android 6–11, `allowBackup=true`)
- `run-as` extraction (debuggable builds only)
- Scoped-storage `Android/data/<pkg>/` reads (version-dependent path)

The **impossible without root** recoveries are:

- Direct read of `/data/data/<pkg>/` private databases

The product is honest about all of the above. That honesty is the product.

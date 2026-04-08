# Sample recovery bundle

This directory ships a **tiny pre-built catalog** so anyone who clones the repo can try the catalog browser immediately, without needing an Android device or the original 120 MB Kilter APK.

## What's inside

```
findings/android/sample/
├── README.md                          (this file)
├── _catalog/
│   ├── db.sqlite3                     (~1.8 MB — trimmed to 100 climbs × 2 boards + lookups)
│   └── board-images/
│       ├── 36-1.png                   Original 12×14 (Commercial) — Bolt Ons
│       └── 45-1.png                   Original 12×12 with kickboard — Bolt Ons
└── raw/
    └── .gitkeep                       (placeholder; APK is NOT included)
```

**Total size: ~3 MB**, fully committable to git.

## How to use it

1. Open the app: `bun run dev`
2. Click **Boards** in the sidebar (under the Android branch)
3. Click **"Pick recovery bundle…"**
4. Navigate to and select **`findings/android/sample/`** (the parent of `_catalog/`, not `_catalog/` itself)
5. The two board configurations appear instantly with their rendered images
6. Click any board → see the 100 most popular climbs for that configuration
7. Click any climb → see the full detail view with the holds rendered as a colored SVG overlay on the board image, plus per-angle stats and Instagram beta links

## What's actually in the sample database

| Table | Rows in sample | Why |
|---|---|---|
| `climbs` | 100 | Top 100 most-ascended climbs that fit both boards |
| `climb_cache_fields` | 100 | Aggregate stats for those climbs |
| `climb_stats` | ~1,400 | Per-angle stats (each climb has ~10-15 angles) |
| `beta_links` | ~2,500 | Every Instagram beta video for those climbs |
| `holes` | 3,294 | All physical hole positions on every Kilter product (full lookup) |
| `placements` | 3,773 | Hole → set assignments per layout (full lookup) |
| `placement_roles` | 30 | Start/middle/finish/foot color definitions (full lookup) |
| `product_sizes_layouts_sets` | 41 | All board configurations (full lookup) |
| `products`, `layouts`, `sets`, `product_sizes`, `difficulty_grades`, `kits`, `leds`, `attempts` | full | Reference data, all small |

The lookup tables are copied **in full** because they're tiny (a few hundred KB combined) and the catalog browser needs them to render the holds correctly. The big tables (`climbs`, `climb_stats`, `beta_links`, `climb_cache_fields`) are filtered to just the rows for the 100 selected climbs.

## How the catalog browser uses this directory

When you click **Boards → Pick recovery bundle…** and select `findings/android/sample/`, [`KilterCatalogService.openFromBundle`](../../../electron/services/catalog/KilterCatalogService.ts) does this:

1. Looks for a Kilter APK in `raw/` — **doesn't find one** (intentional)
2. Falls back to checking if `_catalog/db.sqlite3` already exists — **yes, it does**
3. Skips APK extraction entirely and opens the pre-built database directly
4. Reads the board images from `_catalog/board-images/`
5. Precomputes the catalog (this is fast — only 100 climbs to bucket)
6. The Boards / Climbs / Climb detail screens then work normally

## Rebuilding the sample

If you have a real recovery bundle and want to regenerate the sample (e.g. with different boards or more climbs), run:

```bash
bun scripts/build-sample-catalog.js
```

This auto-discovers the source `db.sqlite3` from your most recent recovery and rebuilds `findings/android/sample/_catalog/`. To customize which boards or how many climbs, edit the `SAMPLE_COMBO_IDS` and `CLIMBS_PER_BOARD` constants at the top of [scripts/build-sample-catalog.js](../../../scripts/build-sample-catalog.js).

Note: the script must run with **`bun`**, not `node`. It uses `bun:sqlite` (bun's bundled SQLite) to dodge the better-sqlite3 ABI conflict — the better-sqlite3 in this repo is rebuilt for Electron 32's Node ABI and won't load under system Node.

## Want the full catalog instead?

The sample only has 100 climbs across 2 boards. The full catalog has **251,298 climbs across 22 boards** plus the complete Tension Board catalog. To get it, you need to either:

- **Run a real recovery** against an Android device that has Kilter Board installed (see the main [README.md](../../../README.md))
- **Get a copy of `com.auroraclimbing.kilterboard__base.apk`** (~120 MB) from someone who has, drop it in `findings/android/sample/raw/`, delete the `_catalog/` directory so the service re-extracts from the APK, and re-open the bundle

## Legal / ethical notes

The Kilter Board catalog data is the property of **Aurora Climbing**. The 100 climbs in this sample are taken from the public catalog that ships embedded in every release of the Kilter Board app — they are content already in widespread distribution to every user of the app.

This sample is included in the repository in good faith, for the limited purpose of demonstrating an open-source forensic recovery toolkit. If you are a representative of Aurora Climbing and would prefer this sample not be hosted publicly, please open an issue and the maintainer will remove it immediately.

The toolkit itself does not redistribute Kilter's content beyond what's in this directory — every recovered artifact stays on the user's machine unless they explicitly export it.

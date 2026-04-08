#!/usr/bin/env node
// Builds a tiny demo catalog for findings/android/sample/_catalog/.
//
// Reads the full recovered db.sqlite3 + board images, picks 2 popular board
// configurations, takes the top 100 climbs from each by ascensionist count,
// and writes a self-contained ~3-4 MB SQLite + 2 PNGs that the catalog
// browser can open without needing the original 120 MB APK.
//
// The output sample is committable to git and works as a true quickstart
// for anyone who clones the repo.
//
// Usage:
//   bun scripts/build-sample-catalog.js [path/to/source/db.sqlite3] [path/to/board-images-dir]
//
// IMPORTANT: must be run with `bun`, not `node`. Uses bun:sqlite (the bundled
// SQLite) to avoid the better-sqlite3 ABI conflict — better-sqlite3 in this
// repo is rebuilt for Electron 32's Node ABI and won't load under system Node.
//
// Defaults:
//   source db    = findings/android/extracted/kilterboard/assets/db.sqlite3
//                  or any findings/android/<bundle>/_catalog/db.sqlite3
//   board images = findings/android/board-images-original/
//                  or findings/android/<bundle>/_catalog/board-images/

const fs = require('node:fs');
const path = require('node:path');
const { Database } = require('bun:sqlite');

const projectRoot = path.resolve(__dirname, '..');
const sampleDir = path.join(projectRoot, 'findings', 'android', 'sample');
const sampleCatalogDir = path.join(sampleDir, '_catalog');
const sampleDbPath = path.join(sampleCatalogDir, 'db.sqlite3');
const sampleImageDir = path.join(sampleCatalogDir, 'board-images');

// The two boards we want to ship in the sample. These are the most common
// gym configurations of the Kilter Board Original, so they make for a great
// demo and cover the most likely user need.
const SAMPLE_COMBO_IDS = [
  36,  // Kilter Board Original — 12 x 14 (Commercial) — Bolt Ons
  45   // Kilter Board Original — 12 x 12 with kickboard (Square) — Bolt Ons
];
const CLIMBS_PER_BOARD = 100;

function findSourceDb() {
  // 1. Explicit override
  if (process.argv[2]) return path.resolve(process.argv[2]);

  // 2. The "extracted" path used by older recoveries
  const extracted = path.join(projectRoot, 'findings', 'android', 'extracted', 'kilterboard', 'assets', 'db.sqlite3');
  if (fs.existsSync(extracted)) return extracted;

  // 3. Any bundle's _catalog/db.sqlite3
  const findingsAndroid = path.join(projectRoot, 'findings', 'android');
  if (fs.existsSync(findingsAndroid)) {
    for (const entry of fs.readdirSync(findingsAndroid)) {
      const candidate = path.join(findingsAndroid, entry, '_catalog', 'db.sqlite3');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function findSourceImageDir() {
  if (process.argv[3]) return path.resolve(process.argv[3]);

  // The "extracted" board images path
  const extractedImages = path.join(projectRoot, 'findings', 'android', 'board-images-original');
  if (fs.existsSync(extractedImages) && fs.readdirSync(extractedImages).some((f) => f.endsWith('.png'))) {
    return extractedImages;
  }

  // Any bundle's _catalog/board-images
  const findingsAndroid = path.join(projectRoot, 'findings', 'android');
  if (fs.existsSync(findingsAndroid)) {
    for (const entry of fs.readdirSync(findingsAndroid)) {
      const candidate = path.join(findingsAndroid, entry, '_catalog', 'board-images');
      if (fs.existsSync(candidate) && fs.readdirSync(candidate).some((f) => f.endsWith('.png'))) {
        return candidate;
      }
    }
  }
  return null;
}

const sourceDbPath = findSourceDb();
const sourceImageDir = findSourceImageDir();

if (!sourceDbPath) {
  console.error('Could not find a source db.sqlite3. Run a recovery first or pass the path explicitly.');
  process.exit(1);
}
if (!sourceImageDir) {
  console.error('Could not find a source board-images directory. Run a recovery first or pass the path explicitly.');
  process.exit(1);
}

console.log(`Source db:           ${sourceDbPath}`);
console.log(`Source images:       ${sourceImageDir}`);
console.log(`Output:              ${sampleCatalogDir}`);
console.log('');

// ── Open source DB ──────────────────────────────────────────────────
const src = new Database(sourceDbPath, { readonly: true });

// ── Resolve the chosen combos to their layout/set/bbox ──────────────
const placeholders = SAMPLE_COMBO_IDS.map(() => '?').join(',');
const combos = src.prepare(`
  SELECT pls.id AS combo_id, pls.product_size_id, pls.layout_id, pls.set_id,
         ps.edge_left, ps.edge_right, ps.edge_bottom, ps.edge_top,
         pls.image_filename
  FROM product_sizes_layouts_sets pls
  JOIN product_sizes ps ON ps.id = pls.product_size_id
  WHERE pls.id IN (${placeholders})
`).all(...SAMPLE_COMBO_IDS);

if (combos.length !== SAMPLE_COMBO_IDS.length) {
  console.error(`Expected ${SAMPLE_COMBO_IDS.length} combos, found ${combos.length}. Check SAMPLE_COMBO_IDS.`);
  process.exit(1);
}

console.log('Selected board configurations:');
for (const c of combos) {
  console.log(`  combo ${c.combo_id}: layout=${c.layout_id} set=${c.set_id} bbox=(${c.edge_left},${c.edge_bottom})..(${c.edge_right},${c.edge_top}) image=${c.image_filename}`);
}
console.log('');

// ── Pick top 100 climbs per combo by ascensionist count ─────────────
const placementToSet = new Map();
for (const r of src.prepare('SELECT id, set_id FROM placements').all()) {
  placementToSet.set(r.id, r.set_id);
}
const FRAME_RE = /p(\d+)r(\d+)/g;
function climbSets(framesStr) {
  const sets = new Set();
  let m;
  FRAME_RE.lastIndex = 0;
  while ((m = FRAME_RE.exec(framesStr))) {
    const sid = placementToSet.get(Number.parseInt(m[1], 10));
    if (sid != null) sets.add(sid);
  }
  return sets;
}

const selectedClimbUuids = new Set();
const selectedClimbsPerCombo = new Map();
for (const c of combos) {
  const candidates = src.prepare(`
    SELECT c.uuid, c.frames
    FROM climbs c
    LEFT JOIN climb_cache_fields ccf ON ccf.climb_uuid = c.uuid
    WHERE c.is_listed = 1 AND c.is_draft = 0
      AND c.layout_id = ?
      AND c.edge_left   >= ?
      AND c.edge_right  <= ?
      AND c.edge_bottom >= ?
      AND c.edge_top    <= ?
    ORDER BY COALESCE(ccf.ascensionist_count, 0) DESC, COALESCE(ccf.quality_average, 0) DESC
    LIMIT 5000
  `).all(c.layout_id, c.edge_left, c.edge_right, c.edge_bottom, c.edge_top);

  // Filter by exact set match
  const passing = [];
  for (const row of candidates) {
    const sets = climbSets(row.frames);
    if (sets.size === 0) continue;
    let ok = true;
    for (const sid of sets) {
      if (sid !== c.set_id) { ok = false; break; }
    }
    if (ok) passing.push(row.uuid);
    if (passing.length >= CLIMBS_PER_BOARD) break;
  }
  selectedClimbsPerCombo.set(c.combo_id, passing);
  for (const u of passing) selectedClimbUuids.add(u);
  console.log(`  combo ${c.combo_id}: selected ${passing.length} climbs`);
}
console.log(`Total unique climb uuids selected: ${selectedClimbUuids.size}`);
console.log('');

// ── Build the output dir and the new SQLite ─────────────────────────
fs.rmSync(sampleCatalogDir, { recursive: true, force: true });
fs.mkdirSync(sampleCatalogDir, { recursive: true });
fs.mkdirSync(sampleImageDir, { recursive: true });

const dst = new Database(sampleDbPath, { create: true });
dst.exec('PRAGMA journal_mode = OFF');
dst.exec('PRAGMA synchronous = OFF');

// Copy the schema (full DDL) for every table we care about. We use the
// source's sqlite_master to get the exact CREATE statements so the schema
// matches 1:1 and the catalog browser doesn't notice anything is different.
const TABLES_TO_COPY = [
  // Lookup tables — copied in full
  { name: 'android_metadata',         filter: null },
  { name: 'attempts',                 filter: null },
  { name: 'difficulty_grades',        filter: null },
  { name: 'holes',                    filter: null },
  { name: 'kits',                     filter: null },
  { name: 'layouts',                  filter: null },
  { name: 'leds',                     filter: null },
  { name: 'placement_roles',          filter: null },
  { name: 'placements',               filter: null },
  { name: 'product_sizes',            filter: null },
  { name: 'product_sizes_layouts_sets', filter: null },
  { name: 'products',                 filter: null },
  { name: 'products_angles',          filter: null },
  { name: 'sets',                     filter: null },
  { name: 'shared_syncs',             filter: null },

  // Climb-scoped tables — only rows for selected climbs
  { name: 'climbs',                   filter: 'uuid IN (?)' },
  { name: 'climb_cache_fields',       filter: 'climb_uuid IN (?)' },
  { name: 'climb_stats',              filter: 'climb_uuid IN (?)' },
  { name: 'beta_links',               filter: 'climb_uuid IN (?)' }
];

const uuidList = [...selectedClimbUuids];

for (const t of TABLES_TO_COPY) {
  const ddl = src.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(t.name);
  if (!ddl) {
    console.warn(`  skip ${t.name}: not in source schema`);
    continue;
  }
  dst.exec(ddl.sql);

  let rows;
  if (!t.filter) {
    rows = src.prepare(`SELECT * FROM "${t.name}"`).all();
  } else {
    // Batch the IN clause to dodge SQLite param limits
    rows = [];
    const BATCH = 500;
    for (let i = 0; i < uuidList.length; i += BATCH) {
      const slice = uuidList.slice(i, i + BATCH);
      const ph = slice.map(() => '?').join(',');
      const col = t.filter.split(' ')[0];
      const slabRows = src.prepare(`SELECT * FROM "${t.name}" WHERE ${col} IN (${ph})`).all(...slice);
      rows.push(...slabRows);
    }
  }

  if (rows.length === 0) {
    console.log(`  ${t.name.padEnd(28)} ${rows.length} rows`);
    continue;
  }
  // Build a generic INSERT for this table
  const cols = Object.keys(rows[0]);
  const colList = cols.map((c) => `"${c}"`).join(',');
  const phList = cols.map(() => '?').join(',');
  const stmt = dst.prepare(`INSERT OR REPLACE INTO "${t.name}" (${colList}) VALUES (${phList})`);
  const insertMany = dst.transaction((batch) => {
    for (const row of batch) {
      stmt.run(...cols.map((c) => row[c]));
    }
  });
  insertMany(rows);
  console.log(`  ${t.name.padEnd(28)} ${rows.length} rows`);
}

// Also copy any indexes that were on these tables (purely for size — better-sqlite3
// reads fine without them but it makes the file feel "real")
const indexes = src.prepare(`SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL`).all();
for (const idx of indexes) {
  try { dst.exec(idx.sql); } catch { /* some indexes may reference dropped tables — skip */ }
}

dst.exec('VACUUM');
dst.close();
src.close();

const dbStat = fs.statSync(sampleDbPath);
console.log('');
console.log(`✅ wrote ${sampleDbPath} (${(dbStat.size / 1024 / 1024).toFixed(2)} MB)`);

// ── Copy the 2 board images ─────────────────────────────────────────
let copiedImages = 0;
for (const c of combos) {
  const baseName = c.image_filename.split('/').pop();
  const srcFile = path.join(sourceImageDir, baseName);
  if (!fs.existsSync(srcFile)) {
    console.warn(`  ⚠ image not found: ${srcFile}`);
    continue;
  }
  const dstFile = path.join(sampleImageDir, baseName);
  fs.copyFileSync(srcFile, dstFile);
  const sz = fs.statSync(dstFile).size;
  console.log(`✅ wrote ${dstFile} (${(sz / 1024).toFixed(0)} KB)`);
  copiedImages++;
}

console.log('');
console.log(`Sample catalog ready at ${sampleCatalogDir}`);
console.log(`  ${copiedImages} board images, ${selectedClimbUuids.size} climbs across ${combos.length} configurations`);
console.log('');
console.log('Try it:');
console.log('  bun run dev');
console.log('  → Boards → Pick recovery bundle → choose findings/android/sample/');

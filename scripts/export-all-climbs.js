#!/usr/bin/env node
// Export every listed climb from the recovered Kilter db.sqlite3 into:
//   - one master CSV with all climbs
//   - one CSV per official board configuration (size + set)
//   - one JSON per board configuration with richer data
//   - a summary.md
//
// Usage: node scripts/export-all-climbs.js <db.sqlite3> <out-dir>

const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');

const dbPath = process.argv[2];
const outDir = process.argv[3];
if (!dbPath || !outDir) {
  console.error('usage: node export-all-climbs.js <db.sqlite3> <out-dir>');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(outDir, 'by-config'), { recursive: true });
fs.mkdirSync(path.join(outDir, 'by-config-json'), { recursive: true });

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

// ── 1. Lookups: placements → set_id (so we can identify which sets a climb uses)
console.log('[1/7] loading placement → set lookup...');
const placementToSet = new Map();
for (const row of db.prepare('SELECT id, set_id FROM placements').all()) {
  placementToSet.set(row.id, row.set_id);
}
console.log(`      ${placementToSet.size} placements indexed`);

// ── 2. Lookups: set names, layout names, size info, difficulty grades
const setName = new Map();
for (const row of db.prepare('SELECT id, name FROM sets').all()) setName.set(row.id, row.name);

const layoutName = new Map();
for (const row of db.prepare('SELECT id, name FROM layouts').all()) layoutName.set(row.id, row.name);

const productSizes = db.prepare(`
  SELECT ps.id, ps.product_id, p.name AS product_name, ps.name AS size_name,
         ps.description, ps.edge_left, ps.edge_right, ps.edge_bottom, ps.edge_top, ps.image_filename
  FROM product_sizes ps
  JOIN products p ON p.id = ps.product_id
  WHERE ps.is_listed = 1
`).all();
const sizeById = new Map();
for (const s of productSizes) sizeById.set(s.id, s);

const difficultyByGrade = new Map();
for (const row of db.prepare('SELECT difficulty, boulder_name FROM difficulty_grades').all()) {
  difficultyByGrade.set(row.difficulty, row.boulder_name);
}

// ── 3. Pull all valid (layout, size, set) combos = the official board configurations
console.log('[2/7] loading board configurations...');
const configs = db.prepare(`
  SELECT pls.id AS combo_id,
         pls.product_size_id, pls.layout_id, pls.set_id,
         ps.product_id,
         p.name AS product_name,
         ps.name AS size_name,
         ps.description AS size_desc,
         ps.edge_left, ps.edge_right, ps.edge_bottom, ps.edge_top,
         l.name AS layout_name,
         s.name AS set_name,
         pls.image_filename
  FROM product_sizes_layouts_sets pls
  JOIN product_sizes ps ON ps.id = pls.product_size_id
  JOIN layouts l ON l.id = pls.layout_id
  JOIN sets s ON s.id = pls.set_id
  JOIN products p ON p.id = ps.product_id
  WHERE pls.is_listed = 1
`).all();
console.log(`      ${configs.length} official configurations`);

// ── 4. Pull all listed climbs of layout 1 (Original) and 8 (Homewall)
console.log('[3/7] loading climbs (Original + Homewall)...');
const climbs = db.prepare(`
  SELECT c.uuid, c.layout_id, c.setter_id, c.setter_username, c.name, c.description,
         c.hsm, c.edge_left, c.edge_right, c.edge_bottom, c.edge_top,
         c.angle, c.frames, c.is_listed, c.created_at,
         ccf.ascensionist_count, ccf.display_difficulty AS cache_display_difficulty,
         ccf.quality_average AS cache_quality_average
  FROM climbs c
  LEFT JOIN climb_cache_fields ccf ON ccf.climb_uuid = c.uuid
  WHERE c.is_listed = 1
    AND c.is_draft = 0
    AND c.layout_id IN (1, 8)
`).all();
console.log(`      ${climbs.length.toLocaleString()} listed climbs loaded`);

// ── 5. Pull per-angle stats and beta links, indexed by climb_uuid
console.log('[4/7] loading per-angle climb_stats...');
const statsByClimb = new Map();
for (const row of db.prepare(`
  SELECT climb_uuid, angle, display_difficulty, benchmark_difficulty,
         ascensionist_count, difficulty_average, quality_average, fa_username, fa_at
  FROM climb_stats
`).all()) {
  if (!statsByClimb.has(row.climb_uuid)) statsByClimb.set(row.climb_uuid, []);
  statsByClimb.get(row.climb_uuid).push(row);
}
console.log(`      ${statsByClimb.size.toLocaleString()} climbs have per-angle stats`);

console.log('[5/7] loading beta_links...');
const betaByClimb = new Map();
for (const row of db.prepare(`
  SELECT climb_uuid, link, foreign_username, angle, thumbnail
  FROM beta_links
  WHERE is_listed = 1
`).all()) {
  if (!betaByClimb.has(row.climb_uuid)) betaByClimb.set(row.climb_uuid, []);
  betaByClimb.get(row.climb_uuid).push(row);
}
console.log(`      ${betaByClimb.size.toLocaleString()} climbs have beta links`);

// ── 6. For each climb, parse frames to determine which sets it actually uses
console.log('[6/7] parsing frames to determine sets per climb...');
const FRAME_RE = /p(\d+)r(\d+)/g;
let parseErrors = 0;
for (const c of climbs) {
  const sets = new Set();
  let m;
  FRAME_RE.lastIndex = 0;
  while ((m = FRAME_RE.exec(c.frames))) {
    const placementId = Number.parseInt(m[1], 10);
    const setId = placementToSet.get(placementId);
    if (setId != null) sets.add(setId);
  }
  c._setIds = [...sets].sort((a, b) => a - b);
  c._setNames = c._setIds.map((id) => setName.get(id) ?? `set_${id}`);
  if (c._setIds.length === 0) parseErrors++;
}
console.log(`      ${(climbs.length - parseErrors).toLocaleString()} climbs successfully classified by set, ${parseErrors} unclassified`);

// ── Helpers ──
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
function csvRow(arr) { return arr.map(csvCell).join(','); }

function climbBestStats(c) {
  const stats = statsByClimb.get(c.uuid) ?? [];
  if (stats.length === 0) return { angles: [], best: null };
  // pick the angle with the most ascensionists as the "canonical" stat
  let best = stats[0];
  for (const s of stats) {
    if (s.ascensionist_count > best.ascensionist_count) best = s;
  }
  return { angles: stats, best };
}

function fitsConfig(climb, cfg) {
  // Climb must fit in the config's bounding box
  if (climb.edge_left   < cfg.edge_left)   return false;
  if (climb.edge_right  > cfg.edge_right)  return false;
  if (climb.edge_bottom < cfg.edge_bottom) return false;
  if (climb.edge_top    > cfg.edge_top)    return false;
  // Climb must use only the set this config provides (climb's sets ⊆ {cfg.set_id})
  // Climbs typically use a single set; if any used set isn't this config's set, exclude.
  for (const sid of climb._setIds) {
    if (sid !== cfg.set_id) return false;
  }
  // Climb must use at least one set (skip totally unclassified)
  if (climb._setIds.length === 0) return false;
  // Layout must match the config
  if (climb.layout_id !== cfg.layout_id) return false;
  return true;
}

function configSlug(cfg) {
  const product = cfg.product_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const size = cfg.size_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const set = cfg.set_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${product}__${size}__${set}`;
}

// ── 7. Write master CSV ──
console.log('[7/7] writing exports...');

const MASTER_HEADERS = [
  'uuid', 'layout_id', 'layout_name', 'name', 'setter_username', 'setter_id',
  'description',
  'edge_left', 'edge_right', 'edge_bottom', 'edge_top',
  'set_ids', 'set_names',
  'frames_count', 'ascensionist_count_cache', 'quality_average_cache',
  'display_difficulty_cache', 'best_angle', 'best_angle_ascensionists',
  'best_angle_display_difficulty', 'best_angle_grade',
  'beta_link_count', 'created_at',
  'frames'
];

const masterPath = path.join(outDir, 'all-listed-climbs.csv');
const masterStream = fs.createWriteStream(masterPath);
masterStream.write(MASTER_HEADERS.join(',') + '\n');

let masterCount = 0;
for (const c of climbs) {
  const { best } = climbBestStats(c);
  const grade = best ? difficultyByGrade.get(Math.round(best.display_difficulty)) ?? '' : '';
  const beta = betaByClimb.get(c.uuid) ?? [];
  masterStream.write(csvRow([
    c.uuid, c.layout_id, layoutName.get(c.layout_id) ?? '', c.name, c.setter_username, c.setter_id,
    c.description,
    c.edge_left, c.edge_right, c.edge_bottom, c.edge_top,
    c._setIds.join('|'), c._setNames.join('|'),
    c.frames_count, c.ascensionist_count, c.cache_quality_average,
    c.cache_display_difficulty, best?.angle ?? '', best?.ascensionist_count ?? '',
    best?.display_difficulty ?? '', grade,
    beta.length, c.created_at,
    c.frames
  ]) + '\n');
  masterCount++;
}
masterStream.end();
console.log(`      master CSV written: ${masterCount.toLocaleString()} rows → ${masterPath}`);

// ── Per-config exports ──
const configReport = [];
for (const cfg of configs) {
  const matching = climbs.filter((c) => fitsConfig(c, cfg));
  if (matching.length === 0) {
    configReport.push({ ...cfg, count: 0 });
    continue;
  }
  // Sort by popularity then quality
  matching.sort((a, b) =>
    (b.ascensionist_count ?? 0) - (a.ascensionist_count ?? 0) ||
    (b.cache_quality_average ?? 0) - (a.cache_quality_average ?? 0)
  );

  const slug = configSlug(cfg);

  // CSV
  const csvPath = path.join(outDir, 'by-config', `${slug}.csv`);
  const csvStream = fs.createWriteStream(csvPath);
  csvStream.write(MASTER_HEADERS.join(',') + '\n');
  for (const c of matching) {
    const { best } = climbBestStats(c);
    const grade = best ? difficultyByGrade.get(Math.round(best.display_difficulty)) ?? '' : '';
    const beta = betaByClimb.get(c.uuid) ?? [];
    csvStream.write(csvRow([
      c.uuid, c.layout_id, layoutName.get(c.layout_id) ?? '', c.name, c.setter_username, c.setter_id,
      c.description,
      c.edge_left, c.edge_right, c.edge_bottom, c.edge_top,
      c._setIds.join('|'), c._setNames.join('|'),
      c.frames_count, c.ascensionist_count, c.cache_quality_average,
      c.cache_display_difficulty, best?.angle ?? '', best?.ascensionist_count ?? '',
      best?.display_difficulty ?? '', grade,
      beta.length, c.created_at,
      c.frames
    ]) + '\n');
  }
  csvStream.end();

  // JSON (richer — full per-angle stats and beta links inline)
  const jsonPath = path.join(outDir, 'by-config-json', `${slug}.json`);
  const jsonObj = {
    config: {
      combo_id: cfg.combo_id,
      product: cfg.product_name,
      size: cfg.size_name,
      size_description: cfg.size_desc,
      layout: cfg.layout_name,
      set: cfg.set_name,
      layout_id: cfg.layout_id,
      product_size_id: cfg.product_size_id,
      set_id: cfg.set_id,
      bounding_box: {
        left: cfg.edge_left, right: cfg.edge_right,
        bottom: cfg.edge_bottom, top: cfg.edge_top
      },
      image: cfg.image_filename
    },
    climb_count: matching.length,
    climbs: matching.map((c) => ({
      uuid: c.uuid,
      name: c.name,
      setter_username: c.setter_username,
      description: c.description,
      created_at: c.created_at,
      bbox: { left: c.edge_left, right: c.edge_right, bottom: c.edge_bottom, top: c.edge_top },
      sets: c._setNames,
      ascensionist_count: c.ascensionist_count,
      quality_average: c.cache_quality_average,
      display_difficulty: c.cache_display_difficulty,
      angles: (statsByClimb.get(c.uuid) ?? []).map((s) => ({
        angle: s.angle,
        display_difficulty: s.display_difficulty,
        grade: difficultyByGrade.get(Math.round(s.display_difficulty)) ?? null,
        benchmark_difficulty: s.benchmark_difficulty,
        ascensionist_count: s.ascensionist_count,
        quality_average: s.quality_average,
        first_ascent_username: s.fa_username,
        first_ascent_at: s.fa_at
      })),
      beta_links: (betaByClimb.get(c.uuid) ?? []).map((b) => ({
        link: b.link, foreign_username: b.foreign_username, angle: b.angle, thumbnail: b.thumbnail
      })),
      frames: c.frames,
      frames_count: c.frames_count
    }))
  };
  fs.writeFileSync(jsonPath, JSON.stringify(jsonObj, null, 2));

  configReport.push({ ...cfg, count: matching.length });
  console.log(`      [${cfg.combo_id}] ${cfg.product_name} ${cfg.size_name} ${cfg.set_name}: ${matching.length.toLocaleString()} climbs`);
}

// ── summary.md ──
const summaryLines = [];
summaryLines.push('# Kilter Recovery — All Listed Climbs Export');
summaryLines.push('');
summaryLines.push(`Generated: ${new Date().toISOString()}`);
summaryLines.push(`Source: ${dbPath}`);
summaryLines.push('');
summaryLines.push(`Total listed climbs across Original + Homewall: **${climbs.length.toLocaleString()}**`);
summaryLines.push('');
summaryLines.push('## Files');
summaryLines.push('');
summaryLines.push('- `all-listed-climbs.csv` — every climb from layouts 1 (Original) and 8 (Homewall) in a single CSV. Open in Excel / Google Sheets.');
summaryLines.push('- `by-config/*.csv` — climbs filtered for each official board configuration.');
summaryLines.push('- `by-config-json/*.json` — same data, richer (full per-angle stats and Instagram beta links).');
summaryLines.push('- `summary.md` — this file.');
summaryLines.push('');
summaryLines.push('## Climbs per board configuration');
summaryLines.push('');
summaryLines.push('| # | Product | Size | Set | Climbs |');
summaryLines.push('|---|---------|------|-----|-------:|');
configReport.sort((a, b) => b.count - a.count);
for (const r of configReport) {
  summaryLines.push(`| ${r.combo_id} | ${r.product_name} | ${r.size_name} | ${r.set_name} | ${r.count.toLocaleString()} |`);
}
summaryLines.push('');
summaryLines.push('## CSV column reference');
summaryLines.push('');
summaryLines.push('| Column | Meaning |');
summaryLines.push('|---|---|');
summaryLines.push('| uuid | Kilter climb UUID (stable, unique) |');
summaryLines.push('| layout_id / layout_name | Which board layout this climb is for (1=Original, 8=Homewall) |');
summaryLines.push('| name / description | Title and description the setter wrote |');
summaryLines.push('| setter_username / setter_id | Who created the problem |');
summaryLines.push('| edge_left/right/bottom/top | Bounding box of the climb in board coordinates |');
summaryLines.push('| set_ids / set_names | Which hold sets the climb requires (Bolt Ons, Screw Ons, Mainline, etc.) |');
summaryLines.push('| frames_count | Number of frames in the climb (1 = static, >1 = sequence) |');
summaryLines.push('| ascensionist_count_cache | How many people have logged this climb |');
summaryLines.push('| quality_average_cache | 1-3 star rating average |');
summaryLines.push('| display_difficulty_cache | Difficulty index (V-grade lookup via difficulty_grades) |');
summaryLines.push('| best_angle | Angle with the most ascensionists |');
summaryLines.push('| best_angle_grade | V-grade at the most popular angle |');
summaryLines.push('| beta_link_count | How many Instagram beta videos exist for this climb |');
summaryLines.push('| frames | Raw `p<placement_id>r<role_id>` string — the actual hold pattern |');

fs.writeFileSync(path.join(outDir, 'summary.md'), summaryLines.join('\n'));
console.log(`\n✅ done. summary at ${path.join(outDir, 'summary.md')}`);
db.close();

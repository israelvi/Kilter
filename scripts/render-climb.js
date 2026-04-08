#!/usr/bin/env node
// Render a single Kilter climb as an SVG overlay on its board image.
//
// Picks (or accepts a uuid for) a popular V4-ish climb on Original 12x14 Bolt Ons,
// resolves every placement to (x,y) hole coordinates and to a placement role
// (start/finish/hand/foot/etc), then writes:
//   - <slug>.json    — full climb info (stats, beta, holds with coordinates+roles)
//   - <slug>.svg     — standalone SVG, the climb drawn over the board render
//   - <slug>.html    — quick viewer (board render + SVG overlay + metadata table)
//
// Usage:
//   node scripts/render-climb.js <db.sqlite3> <board-image.png> <out-dir> [climb-uuid]

const Database = require('better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');

const dbPath = process.argv[2];
const boardImage = process.argv[3];
const outDir = process.argv[4];
const wantUuid = process.argv[5];

if (!dbPath || !boardImage || !outDir) {
  console.error('usage: render-climb.js <db.sqlite3> <board-image.png> <out-dir> [climb-uuid]');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

// ── 1. Pick the climb ──────────────────────────────────────────────────────
// Layout 1 = Kilter Board Original
// Size 7  = 12x14 Commercial
// Set 1   = Bolt Ons
// We want a popular V4 (display_difficulty ≈ 16-17 based on difficulty_grades)
// from the climb_stats table — that's the most-ascended angle for the climb.

// Lookup grade names so we can be precise
const grades = db.prepare('SELECT difficulty, boulder_name FROM difficulty_grades').all();
const gradeName = new Map(grades.map((g) => [g.difficulty, g.boulder_name]));
const v4Difficulties = grades.filter((g) => g.boulder_name.includes('V4')).map((g) => g.difficulty);
console.log(`V4 difficulty range: ${v4Difficulties.join(', ')} → ${v4Difficulties.map((d) => gradeName.get(d)).join(', ')}`);

let climb;
if (wantUuid) {
  climb = db.prepare(`
    SELECT c.*, ccf.ascensionist_count, ccf.quality_average AS cache_quality, ccf.display_difficulty AS cache_diff
    FROM climbs c
    LEFT JOIN climb_cache_fields ccf ON ccf.climb_uuid = c.uuid
    WHERE c.uuid = ?
  `).get(wantUuid);
  if (!climb) { console.error(`climb ${wantUuid} not found`); process.exit(1); }
} else {
  // Pick a popular, well-rated V4 on 12x14 Bolt Ons.
  // Constraints: layout_id=1, fits inside size 7 bbox (left>=0, right<=144, bottom>=0, top<=180),
  // and uses set_id 1 (Bolt Ons) only.
  // Filter on climb_cache_fields cache for speed, then verify set in JS.
  climb = db.prepare(`
    SELECT c.uuid, c.layout_id, c.setter_id, c.setter_username, c.name, c.description,
           c.edge_left, c.edge_right, c.edge_bottom, c.edge_top, c.frames, c.frames_count, c.created_at,
           ccf.ascensionist_count, ccf.quality_average AS cache_quality, ccf.display_difficulty AS cache_diff
    FROM climbs c
    JOIN climb_cache_fields ccf ON ccf.climb_uuid = c.uuid
    WHERE c.is_listed = 1
      AND c.is_draft = 0
      AND c.layout_id = 1
      AND c.edge_left >= 0 AND c.edge_right <= 144
      AND c.edge_bottom >= 0 AND c.edge_top <= 180
      AND ccf.ascensionist_count > 200
      AND ccf.quality_average >= 2.7
      AND ccf.display_difficulty BETWEEN 16 AND 17
    ORDER BY ccf.ascensionist_count DESC
    LIMIT 50
  `).all();
}

// If we got a list, we need to filter to one whose frames only use Bolt Ons (set 1).
const FRAME_RE = /p(\d+)r(\d+)/g;
const placementToSet = new Map();
for (const row of db.prepare('SELECT id, set_id FROM placements').all()) placementToSet.set(row.id, row.set_id);

function classifyClimbSets(framesStr) {
  const sets = new Set();
  let m;
  FRAME_RE.lastIndex = 0;
  while ((m = FRAME_RE.exec(framesStr))) {
    const sid = placementToSet.get(Number.parseInt(m[1], 10));
    if (sid != null) sets.add(sid);
  }
  return [...sets];
}

if (Array.isArray(climb)) {
  const cands = climb;
  climb = null;
  for (const c of cands) {
    const sets = classifyClimbSets(c.frames);
    if (sets.length === 1 && sets[0] === 1) {
      climb = c;
      break;
    }
  }
  if (!climb) { console.error('no V4 found that uses only Bolt Ons; relax filter'); process.exit(1); }
}

console.log(`\nselected climb: "${climb.name}" by ${climb.setter_username}`);
console.log(`  uuid: ${climb.uuid}`);
console.log(`  ascensionists: ${climb.ascensionist_count}, quality: ${climb.cache_quality}, difficulty: ${climb.cache_diff}`);

// ── 2. Resolve every placement in the climb's frames ──────────────────────
// Get layout's product_id so we can reach holes/leds and placement_roles
const layout = db.prepare('SELECT * FROM layouts WHERE id = ?').get(climb.layout_id);
const product = db.prepare('SELECT * FROM products WHERE id = ?').get(layout.product_id);

// Pre-load lookup tables we'll need:
const holesById = new Map();
for (const row of db.prepare('SELECT id, product_id, name, x, y, mirrored_hole_id FROM holes WHERE product_id = ?').all(product.id)) {
  holesById.set(row.id, row);
}

const placementsById = new Map();
for (const row of db.prepare('SELECT id, layout_id, hole_id, set_id, default_placement_role_id FROM placements WHERE layout_id = ?').all(climb.layout_id)) {
  placementsById.set(row.id, row);
}

const rolesById = new Map();
for (const row of db.prepare('SELECT id, product_id, position, name, full_name, led_color, screen_color FROM placement_roles WHERE product_id = ?').all(product.id)) {
  rolesById.set(row.id, row);
}

// ── 3. Parse the climb's frames into structured holds ─────────────────────
const holds = [];
let m;
FRAME_RE.lastIndex = 0;
while ((m = FRAME_RE.exec(climb.frames))) {
  const placementId = Number.parseInt(m[1], 10);
  const roleId = Number.parseInt(m[2], 10);
  const placement = placementsById.get(placementId);
  if (!placement) { console.warn(`  placement ${placementId} not found`); continue; }
  const hole = holesById.get(placement.hole_id);
  if (!hole) { console.warn(`  hole ${placement.hole_id} not found`); continue; }
  const role = rolesById.get(roleId);
  // Kilter DB stores screen_color as a hex string WITHOUT the leading '#',
  // e.g. "00DD00". Prepend it so SVG/CSS treat it as a real color.
  const screenColor = role?.screen_color ? `#${role.screen_color}` : '#888888';
  holds.push({
    placement_id: placementId,
    role_id: roleId,
    role_name: role?.name ?? 'unknown',
    role_full_name: role?.full_name ?? 'unknown',
    role_screen_color: screenColor,
    hole_id: hole.id,
    hole_name: hole.name,
    x: hole.x,
    y: hole.y
  });
}

console.log(`  parsed ${holds.length} holds`);
const roleSummary = {};
for (const h of holds) roleSummary[h.role_full_name] = (roleSummary[h.role_full_name] ?? 0) + 1;
console.log(`  role breakdown: ${JSON.stringify(roleSummary)}`);

// ── 4. Per-angle stats and beta links ─────────────────────────────────────
const stats = db.prepare(`
  SELECT angle, display_difficulty, benchmark_difficulty, ascensionist_count,
         difficulty_average, quality_average, fa_username, fa_at
  FROM climb_stats WHERE climb_uuid = ? ORDER BY ascensionist_count DESC
`).all(climb.uuid);

const beta = db.prepare(`
  SELECT link, foreign_username, angle, thumbnail
  FROM beta_links WHERE climb_uuid = ? AND is_listed = 1 LIMIT 20
`).all(climb.uuid);

// ── 5. Determine SVG view box from the product_size we picked ─────────────
// We assume size 7 (Original 12x14): bbox left=0 right=144 bottom=0 top=180.
const sizeRow = db.prepare('SELECT * FROM product_sizes WHERE id = ?').get(7);
const bbox = {
  left: sizeRow.edge_left,
  right: sizeRow.edge_right,
  bottom: sizeRow.edge_bottom,
  top: sizeRow.edge_top
};
const w = bbox.right - bbox.left;
const h = bbox.top - bbox.bottom;
console.log(`  board bbox: ${JSON.stringify(bbox)}, size ${w}x${h}`);

// SVG y-axis is top-down; board y is bottom-up. Flip.
function svgX(x) { return x - bbox.left; }
function svgY(y) { return bbox.top - y; }

// ── 6. Render the SVG overlay ─────────────────────────────────────────────
// Two SVG flavors:
//   (a) standalone .svg with just the holds drawn on a transparent background sized to the bbox
//   (b) HTML viewer that puts that SVG over the actual board image render

// In board coordinate units. The 12x14 board is 144x180 wide;
// a Kilter hold is roughly 4 units across, so we draw a ring of r=5
// (slightly bigger than the hold itself) with a thick stroke.
const HOLD_RADIUS = 5.5;
const HOLD_STROKE = 1.6;

function holdCircle(h) {
  return `<circle cx="${svgX(h.x)}" cy="${svgY(h.y)}" r="${HOLD_RADIUS}" fill="none" stroke="${h.role_screen_color}" stroke-width="${HOLD_STROKE}" data-role="${h.role_name}" data-hole="${h.hole_name}"><title>${h.hole_name} — ${h.role_full_name}</title></circle>`;
}

const svgBody = holds.map(holdCircle).join('\n  ');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
  ${svgBody}
</svg>`;

const slug = climb.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || climb.uuid;

const svgPath = path.join(outDir, `${slug}.svg`);
fs.writeFileSync(svgPath, svg);

// ── 7. Build the HTML viewer ──────────────────────────────────────────────
// We embed the board image as an absolute path the user can open from the disk.
const boardImageAbs = path.resolve(boardImage).replace(/\\/g, '/');
const boardImageData = fs.readFileSync(boardImage);
const boardImageBase64 = boardImageData.toString('base64');
const boardImageMime = boardImage.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

const stats_table = stats.length === 0 ? '<p><em>(no per-angle stats)</em></p>' : `
<table>
  <thead><tr><th>Angle</th><th>Display difficulty</th><th>Grade</th><th>Ascensionists</th><th>Quality avg</th><th>FA</th><th>FA at</th></tr></thead>
  <tbody>
    ${stats.map((s) => `<tr><td>${s.angle}°</td><td>${s.display_difficulty.toFixed(2)}</td><td>${gradeName.get(Math.round(s.display_difficulty)) ?? ''}</td><td>${s.ascensionist_count}</td><td>${s.quality_average.toFixed(2)}</td><td>${s.fa_username}</td><td>${s.fa_at}</td></tr>`).join('')}
  </tbody>
</table>`;

const beta_table = beta.length === 0 ? '<p><em>(no beta links)</em></p>' : `
<table>
  <thead><tr><th>Link</th><th>Posted by</th><th>Angle</th></tr></thead>
  <tbody>
    ${beta.map((b) => `<tr><td><a href="${b.link}" target="_blank">${b.link}</a></td><td>${b.foreign_username ?? ''}</td><td>${b.angle ?? ''}</td></tr>`).join('')}
  </tbody>
</table>`;

const holds_legend = `
<div class="legend">
  ${[...new Set(holds.map((h) => h.role_full_name))].map((name) => {
    const c = holds.find((h) => h.role_full_name === name).role_screen_color;
    const cnt = holds.filter((h) => h.role_full_name === name).length;
    return `<span class="legend-item"><span class="dot" style="border-color:${c}"></span>${name} (${cnt})</span>`;
  }).join('')}
</div>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${climb.name} — Kilter climb viewer</title>
<style>
  body { font-family: -apple-system, sans-serif; background:#0e1116; color:#e6edf3; margin:0; padding:24px; }
  h1 { margin:0 0 4px; }
  .by { color:#8b96a4; margin:0 0 16px; }
  .layout { display:grid; grid-template-columns: 1fr 1fr; gap:32px; max-width:1600px; margin:auto; }
  .board-wrap { position:relative; background:#161b22; border:1px solid #2a313c; border-radius:8px; padding:16px; }
  .board-wrap img, .board-wrap svg { width:100%; height:auto; display:block; }
  .board-wrap svg { position:absolute; top:16px; left:16px; right:16px; bottom:16px; width:calc(100% - 32px); height:calc(100% - 32px); pointer-events:none; }
  .meta { background:#161b22; border:1px solid #2a313c; border-radius:8px; padding:20px; }
  .meta h2 { font-size:14px; margin:24px 0 8px; text-transform:uppercase; letter-spacing:.5px; color:#8b96a4; }
  .meta h2:first-child { margin-top:0; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid #2a313c; }
  th { color:#8b96a4; font-weight:600; }
  .legend { display:flex; flex-wrap:wrap; gap:16px; margin:12px 0; font-size:13px; }
  .legend-item { display:flex; align-items:center; gap:8px; }
  .dot { width:16px; height:16px; border-radius:50%; box-sizing:border-box; border:3px solid; background:transparent; }
  code { background:#0e1116; padding:2px 6px; border-radius:3px; font-size:12px; }
  a { color:#58a6ff; }
  .desc { color:#c9d1d9; font-style:italic; padding:8px 12px; border-left:3px solid #58a6ff; background:rgba(88,166,255,.05); }
</style>
</head><body>

<div class="layout">
  <div>
    <h1>${climb.name}</h1>
    <p class="by">by <strong>${climb.setter_username}</strong> · created ${climb.created_at}</p>
    <div class="board-wrap">
      <img src="data:${boardImageMime};base64,${boardImageBase64}" alt="board">
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="0.8" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        ${holds.map((h) => {
          const c = h.role_screen_color;
          // Outer black halo for contrast against light board background, then colored ring on top.
          return `<circle cx="${svgX(h.x)}" cy="${svgY(h.y)}" r="${HOLD_RADIUS + 0.4}" fill="none" stroke="#000" stroke-width="${HOLD_STROKE + 1.5}" opacity="0.55"/>
        <circle cx="${svgX(h.x)}" cy="${svgY(h.y)}" r="${HOLD_RADIUS}" fill="none" stroke="${c}" stroke-width="${HOLD_STROKE}" filter="url(#glow)"><title>${h.hole_name} — ${h.role_full_name}</title></circle>`;
        }).join('\n        ')}
      </svg>
    </div>
    ${holds_legend}
    <p style="font-size:11px;color:#8b96a4">Hold colors come from <code>placement_roles.screen_color</code> in the recovered db.sqlite3.</p>
  </div>

  <div class="meta">
    ${climb.description ? `<h2>Description</h2><p class="desc">${climb.description}</p>` : ''}

    <h2>Identity</h2>
    <table>
      <tr><th>UUID</th><td><code>${climb.uuid}</code></td></tr>
      <tr><th>Setter</th><td>${climb.setter_username} (id ${climb.setter_id})</td></tr>
      <tr><th>Layout</th><td>${layout.name} (${product.name})</td></tr>
      <tr><th>Bounding box</th><td>left=${climb.edge_left}, right=${climb.edge_right}, bottom=${climb.edge_bottom}, top=${climb.edge_top}</td></tr>
      <tr><th>Frames count</th><td>${climb.frames_count}</td></tr>
      <tr><th>Total holds</th><td>${holds.length}</td></tr>
      <tr><th>Created at</th><td>${climb.created_at}</td></tr>
    </table>

    <h2>Cached aggregate</h2>
    <table>
      <tr><th>Ascensionists</th><td>${climb.ascensionist_count ?? '—'}</td></tr>
      <tr><th>Quality avg</th><td>${climb.cache_quality?.toFixed(2) ?? '—'} / 3</td></tr>
      <tr><th>Display difficulty</th><td>${climb.cache_diff ?? '—'} → ${gradeName.get(Math.round(climb.cache_diff)) ?? '—'}</td></tr>
    </table>

    <h2>Per-angle stats (${stats.length} angles)</h2>
    ${stats_table}

    <h2>Beta links (${beta.length} videos)</h2>
    ${beta_table}

    <h2>Raw frames string</h2>
    <p style="font-family:monospace;font-size:11px;word-break:break-all;background:#0e1116;padding:8px;border-radius:4px">${climb.frames}</p>
  </div>
</div>

</body></html>`;

const htmlPath = path.join(outDir, `${slug}.html`);
fs.writeFileSync(htmlPath, html);

// JSON dump for the climb
const jsonPath = path.join(outDir, `${slug}.json`);
fs.writeFileSync(jsonPath, JSON.stringify({
  climb: {
    uuid: climb.uuid,
    name: climb.name,
    description: climb.description,
    setter_username: climb.setter_username,
    setter_id: climb.setter_id,
    layout: { id: layout.id, name: layout.name, product: product.name },
    bounding_box: { left: climb.edge_left, right: climb.edge_right, bottom: climb.edge_bottom, top: climb.edge_top },
    frames_count: climb.frames_count,
    created_at: climb.created_at,
    ascensionist_count: climb.ascensionist_count,
    quality_average: climb.cache_quality,
    display_difficulty: climb.cache_diff,
    grade: gradeName.get(Math.round(climb.cache_diff)),
    raw_frames: climb.frames
  },
  holds,
  per_angle_stats: stats,
  beta_links: beta
}, null, 2));

console.log(`\nwrote:`);
console.log(`  ${jsonPath}`);
console.log(`  ${svgPath}`);
console.log(`  ${htmlPath}`);
console.log(`\nopen ${htmlPath} in your browser to see the rendered climb`);

db.close();

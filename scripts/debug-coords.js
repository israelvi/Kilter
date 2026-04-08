const Database = require('better-sqlite3');
const db = new Database('findings/android/extracted/kilterboard/assets/db.sqlite3', { readonly: true });

console.log('=== placement_roles (product 1) ===');
for (const r of db.prepare("SELECT id, position, name, full_name, led_color, screen_color FROM placement_roles WHERE product_id=1 ORDER BY position").all()) {
  console.log(`  id=${r.id} pos=${r.position} ${r.full_name.padEnd(15)} screen="${r.screen_color}" led="${r.led_color}"`);
}

console.log('\n=== holes coord range (product 1) ===');
console.log(JSON.stringify(db.prepare('SELECT MIN(x) AS minx, MAX(x) AS maxx, MIN(y) AS miny, MAX(y) AS maxy, COUNT(*) AS n FROM holes WHERE product_id=1').get()));

console.log('\n=== Bell of the Wall holds ===');
const placements = new Map();
for (const p of db.prepare('SELECT id, hole_id FROM placements WHERE layout_id=1').all()) placements.set(p.id, p.hole_id);
const holesById = new Map();
for (const h of db.prepare('SELECT id, name, x, y FROM holes WHERE product_id=1').all()) holesById.set(h.id, h);
const climb = db.prepare("SELECT frames, edge_left, edge_right, edge_bottom, edge_top FROM climbs WHERE uuid='36E949A6395D4290AF08FDFBCC6010C1'").get();
console.log('climb bbox:', climb.edge_left, climb.edge_right, climb.edge_bottom, climb.edge_top);
console.log('frames:', climb.frames);
const FRAME_RE = /p(\d+)r(\d+)/g;
let m;
while ((m = FRAME_RE.exec(climb.frames))) {
  const pid = +m[1], rid = +m[2];
  const hid = placements.get(pid);
  const hole = holesById.get(hid);
  console.log(`  p${pid} r${rid}: hole ${hole?.name} at (x=${hole?.x}, y=${hole?.y})`);
}
db.close();

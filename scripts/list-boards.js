#!/usr/bin/env node
// Lists every valid board configuration (product × size × layout × set)
// and how many climbs target each layout — so the user can identify their gym.

const Database = require('better-sqlite3');
const path = process.argv[2];
if (!path) { console.error('usage: list-boards.js <db>'); process.exit(1); }
const db = new Database(path, { readonly: true, fileMustExist: true });

console.log('=== PRODUCTS (the 7 board lines) ===\n');
const products = db.prepare('SELECT * FROM products WHERE is_listed=1 ORDER BY id').all();
for (const p of products) {
  console.log(`  [${p.id}] ${p.name}`);
}

console.log('\n=== PRODUCT SIZES (22 physical board sizes) ===\n');
const sizes = db.prepare(`
  SELECT ps.id, ps.product_id, p.name AS product_name, ps.name AS size_name,
         ps.description, ps.edge_left, ps.edge_right, ps.edge_bottom, ps.edge_top
  FROM product_sizes ps
  JOIN products p ON p.id = ps.product_id
  WHERE ps.is_listed = 1
  ORDER BY ps.product_id, ps.position
`).all();
for (const s of sizes) {
  console.log(`  [${s.id}] ${s.product_name} — ${s.size_name}  (${s.description})`);
  console.log(`        bbox: left=${s.edge_left} right=${s.edge_right} bottom=${s.edge_bottom} top=${s.edge_top}`);
}

console.log('\n=== LAYOUTS (8 hold layouts) ===\n');
const layouts = db.prepare(`
  SELECT l.id, l.product_id, p.name AS product_name, l.name AS layout_name, l.is_mirrored
  FROM layouts l
  JOIN products p ON p.id = l.product_id
  WHERE l.is_listed = 1
  ORDER BY l.product_id, l.id
`).all();
for (const l of layouts) {
  console.log(`  [${l.id}] ${l.product_name} — ${l.layout_name}${l.is_mirrored ? ' (mirrored)' : ''}`);
}

console.log('\n=== SETS (11 hold sets) ===\n');
const sets = db.prepare('SELECT * FROM sets ORDER BY id').all();
for (const s of sets) {
  console.log(`  [${s.id}] ${s.name}  (hsm=${s.hsm})`);
}

console.log('\n=== VALID COMBINATIONS (product × size × layout × set) ===\n');
console.log('These are the 41 boards that actually exist as official Kilter configurations.\n');
const combos = db.prepare(`
  SELECT pls.id AS combo_id,
         p.name AS product_name,
         ps.name AS size_name,
         l.name AS layout_name,
         s.name AS set_name,
         ps.id AS size_id,
         l.id AS layout_id,
         s.id AS set_id,
         pls.image_filename
  FROM product_sizes_layouts_sets pls
  JOIN product_sizes ps ON ps.id = pls.product_size_id
  JOIN layouts l ON l.id = pls.layout_id
  JOIN sets s ON s.id = pls.set_id
  JOIN products p ON p.id = ps.product_id
  WHERE pls.is_listed = 1
  ORDER BY p.id, ps.position, l.id, s.id
`).all();
for (const c of combos) {
  console.log(`  [#${c.combo_id}] ${c.product_name} — ${c.size_name} — ${c.layout_name} — ${c.set_name}`);
  console.log(`         layout_id=${c.layout_id} size_id=${c.size_id} set_id=${c.set_id}`);
  console.log(`         image: ${c.image_filename}`);
}

console.log('\n=== CLIMBS PER LAYOUT (popularity by board family) ===\n');
const popular = db.prepare(`
  SELECT c.layout_id, l.name AS layout_name, p.name AS product_name, COUNT(*) AS climb_count
  FROM climbs c
  LEFT JOIN layouts l ON l.id = c.layout_id
  LEFT JOIN products p ON p.id = l.product_id
  WHERE c.is_listed = 1
  GROUP BY c.layout_id
  ORDER BY climb_count DESC
`).all();
for (const r of popular) {
  console.log(`  layout_id=${r.layout_id}  ${r.product_name ?? '?'} / ${r.layout_name ?? '?'}  →  ${r.climb_count.toLocaleString()} listed climbs`);
}

db.close();

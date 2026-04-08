#!/usr/bin/env node
// Quick read-only SQLite inspector for ad-hoc analysis of recovered databases.
// Usage: node scripts/inspect-sqlite.js <path-to-db>

const Database = require('better-sqlite3');
const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/inspect-sqlite.js <db-path>');
  process.exit(1);
}

const db = new Database(path, { readonly: true, fileMustExist: true });

const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log(`\n=== ${path} ===`);
console.log(`tables: ${tables.length}\n`);

for (const t of tables) {
  console.log(`── table: ${t.name} ──`);
  console.log(`schema: ${t.sql}`);
  let count = 0;
  try {
    const c = db.prepare(`SELECT COUNT(*) as n FROM "${t.name.replace(/"/g, '""')}"`).get();
    count = c.n;
  } catch (e) {
    console.log(`  count error: ${e.message}`);
  }
  console.log(`rowcount: ${count}`);
  if (count > 0) {
    try {
      const sample = db.prepare(`SELECT * FROM "${t.name.replace(/"/g, '""')}" LIMIT 5`).all();
      console.log('sample (first 5):');
      for (const row of sample) {
        // Truncate long values for readability
        const truncated = {};
        for (const [k, v] of Object.entries(row)) {
          if (typeof v === 'string' && v.length > 200) {
            truncated[k] = v.slice(0, 200) + `… (${v.length} chars)`;
          } else if (Buffer.isBuffer(v)) {
            truncated[k] = `<BLOB ${v.length} bytes, hex head: ${v.slice(0, 16).toString('hex')}>`;
          } else {
            truncated[k] = v;
          }
        }
        console.log('  ' + JSON.stringify(truncated));
      }
    } catch (e) {
      console.log(`  sample error: ${e.message}`);
    }
  }
  console.log('');
}

const indexes = db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'").all();
if (indexes.length > 0) {
  console.log('── indexes ──');
  for (const i of indexes) console.log(`  ${i.name} on ${i.tbl_name}`);
}

db.close();

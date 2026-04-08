#!/usr/bin/env node
// Compact schema dump: table list + row counts + columns. No sample rows.
// Usage: node scripts/sqlite-schema.js <db-path> [tableNameFilter]

const Database = require('better-sqlite3');
const path = process.argv[2];
const filter = process.argv[3];
if (!path) {
  console.error('usage: node scripts/sqlite-schema.js <db-path> [tableFilter]');
  process.exit(1);
}

const db = new Database(path, { readonly: true, fileMustExist: true });
const tables = db
  .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name")
  .all();

console.log(`# ${path}\n`);
console.log(`${tables.length} tables\n`);

for (const t of tables) {
  if (filter && !t.name.toLowerCase().includes(filter.toLowerCase())) continue;
  let count = 0;
  try {
    count = db.prepare(`SELECT COUNT(*) AS n FROM "${t.name.replace(/"/g, '""')}"`).get().n;
  } catch (e) {
    count = `error: ${e.message}`;
  }
  // Extract columns by parsing PRAGMA table_info
  const cols = db.prepare(`PRAGMA table_info("${t.name.replace(/"/g, '""')}")`).all();
  console.log(`## ${t.name}  (${count} rows)`);
  for (const c of cols) {
    const flags = [];
    if (c.pk) flags.push('PK');
    if (c.notnull) flags.push('NOT NULL');
    if (c.dflt_value != null) flags.push(`default=${c.dflt_value}`);
    console.log(`  - ${c.name}  ${c.type}${flags.length ? '  [' + flags.join(', ') + ']' : ''}`);
  }
  console.log('');
}

db.close();

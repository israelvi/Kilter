#!/usr/bin/env node
// Copies the kilterboard base.apk from an existing recovery bundle into
// findings/android/sample/raw/, so the catalog browser can use it as a quickstart.
//
// Usage:
//   node scripts/setup-sample-bundle.js [path/to/source/bundle]
//
// If no path is given, it picks the most recent KilterRecovery_* bundle
// under findings/android/.

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const findingsAndroid = path.join(projectRoot, 'findings', 'android');
const sampleRawDir = path.join(projectRoot, 'findings', 'android', 'sample', 'raw');

function findMostRecentBundle() {
  if (!fs.existsSync(findingsAndroid)) return null;
  const entries = fs.readdirSync(findingsAndroid, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('KilterRecovery_'))
    .map((e) => e.name)
    .sort()
    .reverse();
  return entries.length > 0 ? path.join(findingsAndroid, entries[0]) : null;
}

function findKilterApk(bundleDir) {
  const rawDir = path.join(bundleDir, 'raw');
  if (!fs.existsSync(rawDir)) return null;
  const files = fs.readdirSync(rawDir);
  const apk = files.find((f) =>
    f.toLowerCase().includes('kilterboard') &&
    f.toLowerCase().endsWith('base.apk')
  );
  return apk ? path.join(rawDir, apk) : null;
}

function main() {
  const explicitBundle = process.argv[2];
  const bundleDir = explicitBundle ? path.resolve(explicitBundle) : findMostRecentBundle();

  if (!bundleDir) {
    console.error('No source bundle found. Run a recovery first, or pass a bundle path explicitly.');
    process.exit(1);
  }
  if (!fs.existsSync(bundleDir)) {
    console.error(`Source bundle does not exist: ${bundleDir}`);
    process.exit(1);
  }

  const apk = findKilterApk(bundleDir);
  if (!apk) {
    console.error(`No kilterboard base.apk found inside ${bundleDir}/raw/`);
    process.exit(1);
  }

  fs.mkdirSync(sampleRawDir, { recursive: true });
  const destName = 'com.auroraclimbing.kilterboard__base.apk';
  const dest = path.join(sampleRawDir, destName);

  console.log(`Copying ${apk}`);
  console.log(`     to ${dest}`);
  fs.copyFileSync(apk, dest);
  const size = fs.statSync(dest).size;
  console.log(`✅ done. ${(size / 1024 / 1024).toFixed(1)} MB`);
  console.log('');
  console.log('You can now open the catalog browser:');
  console.log('  bun run dev');
  console.log('  → click Boards → Pick recovery bundle → choose findings/android/sample/');
  console.log('');
  console.log('Note: this APK is ~120 MB. If you intend to commit it to git, you will need Git LFS:');
  console.log('  git lfs install');
  console.log('  git lfs track "findings/android/sample/raw/*.apk"');
  console.log('  git add .gitattributes findings/android/sample/raw/');
  console.log('');
  console.log('GitHub blocks files > 100 MB pushed without LFS.');
}

main();

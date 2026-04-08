#!/usr/bin/env node
// Tiny launcher: deletes ELECTRON_RUN_AS_NODE (which forces electron into
// plain-Node mode and breaks the electron API), then spawns electron with
// the project root as the entry. Needed because some shells/tools set
// ELECTRON_RUN_AS_NODE=1 globally.

const { spawn } = require('node:child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: false,
  env
});

child.on('close', (code, signal) => {
  if (code === null) {
    console.error('electron exited with signal', signal);
    process.exit(1);
  }
  process.exit(code);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}

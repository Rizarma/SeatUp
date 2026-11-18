#!/usr/bin/env node
// Identitas build yang merepresentasikan source yang diuji, TERMASUK
// working-tree changes (temuan #3): SHA HEAD saja tidak cukup bila ada
// file yang belum di-commit ( Robertson: seluruh perbaikan P2 ada di tree).
// Output: prod-<sha> atau prod-<sha>-dirty-<hash12> (hash = diff terlacak +
// nama+isi file untracked, kecuali yang diabaikan git).
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

const sha = sh('git rev-parse --short HEAD').trim();
const tracked = sh('git diff HEAD -- .');
const untrackedNames = sh('git ls-files --others --exclude-standard -z').split('\0').filter(Boolean);
let extra = tracked;
for (const f of untrackedNames) {
  try {
    extra += `\n--- untracked: ${f}\n` + readFileSync(f, 'utf8');
  } catch {
    extra += `\n--- untracked (unreadable): ${f}\n`;
  }
}
const dirty = sh('git status --porcelain').trim().length > 0;
if (!dirty) {
  console.log(`prod-${sha}`);
} else {
  const h = createHash('sha1').update(extra).digest('hex').slice(0, 12);
  console.log(`prod-${sha}-dirty-${h}`);
}

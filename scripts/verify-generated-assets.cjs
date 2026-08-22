'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const manifestFile = path.join(root, 'generated-assets.manifest.json');
const excluded = new Set(['node_modules', '.git']);

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(target));
    else if (entry.isFile()) files.push(path.relative(root, target).replaceAll(path.sep, '/'));
  }
  return files;
}

const tracked = walk(root).filter(file =>
  (file.endsWith('.html') || file.startsWith('scripts/apply-') || file.startsWith('scripts/validate-'))
  && file !== 'generated-assets.manifest.json'
).sort();
const hashes = Object.fromEntries(tracked.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));

if (process.argv.includes('--write')) {
  fs.writeFileSync(manifestFile, `${JSON.stringify({ algorithm: 'sha256', files: hashes }, null, 2)}\n`);
  console.log(`[generated-assets] recorded ${tracked.length} source/output hashes`);
  process.exit(0);
}

if (!fs.existsSync(manifestFile)) throw new Error('generated-assets.manifest.json is missing; run npm run generate.');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const stale = [...new Set([...Object.keys(manifest.files || {}), ...tracked])].filter(file => manifest.files?.[file] !== hashes[file]);
if (stale.length) {
  console.error('[generated-assets] stale or untracked generated inputs/outputs:');
  stale.forEach(file => console.error(`- ${file}`));
  process.exit(1);
}
console.log(`[generated-assets] PASS — ${tracked.length} source/output hashes match`);

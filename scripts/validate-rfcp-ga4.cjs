const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const MEASUREMENT_ID = 'G-KMZ7QVXGP3';
const EXCLUDED_PREFIXES = ['admin-', 'ops-', 'pipeline-dashboard', 'ag-dashboard'];
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'netlify', 'scripts', 'validation']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function isExcluded(file) {
  const base = path.basename(file, '.html');
  return EXCLUDED_PREFIXES.some(prefix => base.startsWith(prefix));
}

const failures = [];
let checked = 0;
for (const file of walk(ROOT)) {
  if (isExcluded(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  if (!/<head[\s>]/i.test(html)) continue;
  checked++;
  const idCount = (html.match(new RegExp(MEASUREMENT_ID, 'g')) || []).length;
  const loaderCount = (html.match(/googletagmanager\.com\/gtag\/js\?id=/g) || []).length;
  if (idCount < 2 || loaderCount !== 1) {
    failures.push(`${path.relative(ROOT, file)}: expected exactly one GA4 loader and config for ${MEASUREMENT_ID}`);
  }
}

if (!checked) failures.push('No public HTML files were checked.');
if (failures.length) {
  console.error('RFCP GA4 validation failed:\n' + failures.join('\n'));
  process.exit(1);
}
console.log(`RFCP GA4 validation passed for ${checked} public HTML file(s).`);

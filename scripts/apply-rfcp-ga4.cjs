const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const MEASUREMENT_ID = 'G-KMZ7QVXGP3';
const TAG = `<!-- Google tag (gtag.js) -->\n<script async src="https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}"></script>\n<script>\n  window.dataLayer = window.dataLayer || [];\n  function gtag(){dataLayer.push(arguments);}\n  gtag('js', new Date());\n  gtag('config', '${MEASUREMENT_ID}');\n</script>\n`;

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

let changed = 0;
for (const file of walk(ROOT)) {
  if (isExcluded(file)) continue;
  let html = fs.readFileSync(file, 'utf8');
  if (!/<head[\s>]/i.test(html)) continue;
  if (html.includes(MEASUREMENT_ID)) continue;
  html = html.replace(/<head([^>]*)>/i, `<head$1>\n${TAG}`);
  fs.writeFileSync(file, html);
  changed++;
}

console.log(`RFCP GA4 injector complete: ${changed} public HTML file(s) updated with ${MEASUREMENT_ID}.`);

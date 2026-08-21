'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const file = path.join(root, 'index.html');
let html = fs.readFileSync(file, 'utf8');

const PRIMARY = 'https://federalcontractorportal.aproposgroupllc.com/';
const CORPORATE = 'https://aproposgroupllc.com/#organization';

// The public product is the Registered Federal Contractors Portal. NGCC and
// National Government Contract Center remain historical/alias names only.
html = html.replaceAll('https://ngcc.aproposgroupllc.com/', PRIMARY);
html = html.replaceAll('"alternateName":"Registered Federal Contractors Portal"', '"alternateName":["National Government Contract Center","NGCC"]');
html = html.replaceAll('"alternateName":"NGCC"', '"alternateName":["National Government Contract Center","NGCC"]');

// Tie the portal Organization node to the single corporate APROPOS entity.
html = html.replace(
  '"parentOrganization":{"@type":"Organization","name":"Apropos Group LLC"',
  `"parentOrganization":{"@type":"Organization","@id":"${CORPORATE}","name":"APROPOS Group LLC"`,
);

// Phase 2B performance: make the CSS background hero discoverable before CSS parsing.
const heroHref = '/headquarters.webp';
const heroPreload = `<link rel="preload" as="image" href="${heroHref}" type="image/webp" fetchpriority="high">`;
if (!html.includes(`url('${heroHref}')`) && !html.includes(`url("${heroHref}")`) && !html.includes(`url(${heroHref})`)) {
  throw new Error('RFCP performance remediation: active homepage hero reference not found.');
}
if (!html.includes(heroPreload)) {
  if (!/<\/head>/i.test(html)) throw new Error('RFCP performance remediation: closing head tag not found.');
  html = html.replace(/<\/head>/i, `${heroPreload}\n</head>`);
}
if ((html.match(/rel="preload" as="image" href="\/headquarters\.webp"/g) || []).length !== 1) {
  throw new Error('RFCP performance remediation: hero preload must appear exactly once.');
}

fs.writeFileSync(file, html, 'utf8');
console.log('[rfcp-primary-identity] Applied primary portal identity, corporate entity link, NGCC aliases, and high-priority hero preload.');
require('./apply-nonblocking-fonts.cjs');

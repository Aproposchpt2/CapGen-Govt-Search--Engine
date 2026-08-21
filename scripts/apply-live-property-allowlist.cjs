'use strict';

const fs = require('fs');
const path = require('path');
const root = process.cwd();
const rfcp = 'https://federalcontractorportal.aproposgroupllc.com';
const nebcWebsite = 'https://nebc.aproposgroupllc.com/website-builder.html';

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'docs', 'scripts'].includes(entry.name)) return [];
      return walk(full);
    }
    return [full];
  });
}

const htmlFiles = walk(root).filter(file => file.endsWith('.html'));
const runtimeFiles = walk(path.join(root, 'netlify', 'functions')).filter(file => /\.(?:js|mjs|cjs)$/.test(file));
const publicRuntime = [...htmlFiles, ...runtimeFiles];

for (const file of publicRuntime) {
  let value = fs.readFileSync(file, 'utf8');
  value = value
    .replaceAll('https://ngcc.aproposgroupllc.com', rfcp)
    .replaceAll('https://capgenmkt.aproposgroupllc.com', rfcp)
    .replaceAll('https://ai4websitedesign.com', nebcWebsite)
    .replace(/https:\/\/cdc\.aproposgroupllc\.com\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*/gi, `${rfcp}/analyze-fit.html`)
    .replace(/https:\/\/ai4-product-purchasing\.ai4businesses\.org\/(?:ngcc-offer|capgen-offer)\.html/gi, `${rfcp}/onboarding`)
    .replace(/https:\/\/ai4-product-purchasing\.ai4businesses\.org\/analyze-fit(?:\.html)?/gi, `${rfcp}/analyze-fit.html`)
    .replaceAll('National Government Contract Center', 'Registered Federal Contractors Portal')
    .replaceAll('NGCC Analyze Fit', 'Registered Federal Contractors Portal Analyze Fit')
    .replace(/Analyze Fit Report \| NGCC/gi, 'Analyze Fit Report | Registered Federal Contractors Portal')
    .replaceAll('CapGen Pro', 'Registered Federal Contractors Portal')
    .replaceAll('CapGen', 'Registered Federal Contractors Portal');
  fs.writeFileSync(file, value, 'utf8');
}

const forbiddenDomains = [
  'ngcc.aproposgroupllc.com',
  'capgenmkt.aproposgroupllc.com',
  'businesscontracts.aproposgroupllc.com',
  'gcpdc.aproposgroupllc.com',
  'cdc.aproposgroupllc.com',
  'ai4websitedesign.com',
  'ai4-product-purchasing.ai4businesses.org',
];
const failures = [];
for (const file of publicRuntime) {
  const value = fs.readFileSync(file, 'utf8');
  for (const token of forbiddenDomains) {
    if (value.includes(token)) failures.push(`${path.relative(root, file)} contains retired property: ${token}`);
  }
}

for (const file of htmlFiles) {
  const value = fs.readFileSync(file, 'utf8');
  if (/\bCapGen\b/.test(value)) failures.push(`${path.relative(root, file)} still renders retired CapGen branding`);
  if (value.includes('National Government Contract Center')) failures.push(`${path.relative(root, file)} still renders former federal site name`);
}

const homepage = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const required of [
  'Registered Federal Contractors Portal',
  `${rfcp}/`,
  'https://natcorp.aproposgroupllc.com/',
  'https://nebc.aproposgroupllc.com/',
  'https://marketplace.aproposgroupllc.com/',
  '$79.00 one-time',
]) {
  if (!homepage.includes(required)) failures.push(`homepage missing required live-property/price contract: ${required}`);
}
if (!homepage.includes(`${rfcp}/onboarding`)) failures.push('homepage trial CTA does not stay on current RFCP property');

const analyzeFitPath = path.join(root, 'analyze-fit.html');
if (fs.existsSync(analyzeFitPath)) {
  const analyzeFit = fs.readFileSync(analyzeFitPath, 'utf8');
  if (!analyzeFit.includes('Registered Federal Contractors Portal Analyze Fit')) failures.push('Analyze Fit page still exposes retired federal branding');
}

if (failures.length) {
  console.error('[rfcp-live-property-allowlist] Validation failed:');
  failures.forEach(f => console.error(`- ${f}`));
  process.exit(1);
}
console.log('[rfcp-live-property-allowlist] PASS — public/runtime APROPOS routing is limited to the five approved live properties; compatibility identifiers remain internal only.');

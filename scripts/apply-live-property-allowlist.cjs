'use strict';

const fs = require('fs');
const path = require('path');
const root = process.cwd();
const rfcp = 'https://federalcontractorportal.aproposgroupllc.com';
const rfcpBare = 'federalcontractorportal.aproposgroupllc.com';
const nebcWebsite = 'https://nebc.aproposgroupllc.com/website-builder.html';
const nebcWebsiteBare = 'nebc.aproposgroupllc.com/website-builder.html';

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

function normalizeDomains(value) {
  return value
    .replaceAll('https://ngcc.aproposgroupllc.com', rfcp)
    .replaceAll('http://ngcc.aproposgroupllc.com', rfcp)
    .replaceAll('ngcc.aproposgroupllc.com', rfcpBare)
    .replaceAll('https://capgenmkt.aproposgroupllc.com', rfcp)
    .replaceAll('http://capgenmkt.aproposgroupllc.com', rfcp)
    .replaceAll('capgenmkt.aproposgroupllc.com', rfcpBare)
    .replaceAll('https://www.ai4websitedesign.com', nebcWebsite)
    .replaceAll('http://www.ai4websitedesign.com', nebcWebsite)
    .replaceAll('https://ai4websitedesign.com', nebcWebsite)
    .replaceAll('http://ai4websitedesign.com', nebcWebsite)
    .replaceAll('www.ai4websitedesign.com', nebcWebsiteBare)
    .replaceAll('ai4websitedesign.com', nebcWebsiteBare)
    .replace(/https?:\/\/cdc\.aproposgroupllc\.com\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*/gi, `${rfcp}/analyze-fit.html`)
    .replace(/https?:\/\/ai4-product-purchasing\.ai4businesses\.org\/analyze-fit(?:\.html)?[^"'\s<]*/gi, `${rfcp}/analyze-fit.html`)
    .replace(/https?:\/\/ai4-product-purchasing\.ai4businesses\.org\/[A-Za-z0-9._~!$&()*+,;=:@%/?#-]*/gi, `${rfcp}/onboarding`)
    .replace(/ai4-product-purchasing\.ai4businesses\.org\/analyze-fit(?:\.html)?/gi, `${rfcpBare}/analyze-fit.html`)
    .replaceAll('ai4-product-purchasing.ai4businesses.org', rfcpBare)
    .replaceAll('cdc.aproposgroupllc.com', `${rfcpBare}/analyze-fit.html`);
}

function normalizeRenderedHtml(value) {
  let domainClean = normalizeDomains(value)
    .replaceAll('National Government Contract Center', 'Registered Federal Contractors Portal')
    .replaceAll('NGCC Analyze Fit', 'Registered Federal Contractors Portal Analyze Fit')
    .replace(/Analyze Fit Report \| NGCC/gi, 'Analyze Fit Report | Registered Federal Contractors Portal');
  const parts = domainClean.split(/(<script\b[\s\S]*?<\/script>)/gi);
  return parts.map(part => {
    if (/^<script\b/i.test(part)) return part;
    return part
      .replaceAll('CapGen Pro', 'Registered Federal Contractors Portal')
      .replaceAll('CapGen', 'Registered Federal Contractors Portal');
  }).join('');
}

const htmlFiles = walk(root).filter(file => file.endsWith('.html'));
const runtimeFiles = walk(path.join(root, 'netlify', 'functions')).filter(file => /\.(?:js|mjs|cjs)$/.test(file));

for (const file of htmlFiles) {
  const before = fs.readFileSync(file, 'utf8');
  const after = normalizeRenderedHtml(before);
  if (after !== before) fs.writeFileSync(file, after, 'utf8');
}
for (const file of runtimeFiles) {
  const before = fs.readFileSync(file, 'utf8');
  const after = normalizeDomains(before)
    .replaceAll('APROPOS Contract Development Center — Contract Assistance', 'Registered Federal Contractors Portal Contract Assistance');
  if (after !== before) fs.writeFileSync(file, after, 'utf8');
}

const publicRuntime = [...htmlFiles, ...runtimeFiles];
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
  const renderedSurface = value.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  if (/\bCapGen\b/.test(renderedSurface)) failures.push(`${path.relative(root, file)} still renders retired CapGen branding`);
  if (renderedSurface.includes('National Government Contract Center')) failures.push(`${path.relative(root, file)} still renders former federal site name`);
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
  const analyzeFit = fs.readFileSync(analyzeFitPath, 'utf8').replace(/<script\b[\s\S]*?<\/script>/gi, '');
  if (!analyzeFit.includes('Registered Federal Contractors Portal Analyze Fit')) failures.push('Analyze Fit page still exposes retired federal branding');
}

if (failures.length) {
  console.error('[rfcp-live-property-allowlist] Validation failed:');
  failures.forEach(f => console.error(`- ${f}`));
  process.exit(1);
}
console.log('[rfcp-live-property-allowlist] PASS — public/runtime APROPOS routing is limited to the five approved live properties; compatibility identifiers remain internal only.');

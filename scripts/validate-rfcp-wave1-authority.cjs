'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const ORIGIN = 'https://federalcontractorportal.aproposgroupllc.com';
const legacyFullName = ['National', 'Government', 'Contract', 'Center'].join(' ');
const failures = [];

const pages = [
  {
    file: 'guides/index.html',
    url: `${ORIGIN}/guides/`,
    required: ['Registered Federal Contractors Portal', 'APROPOS Group LLC', 'https://sam.gov/opportunities', 'https://www.sba.gov/counseling/get-started/'],
  },
  {
    file: 'federal-contract-opportunity-matching/index.html',
    url: `${ORIGIN}/federal-contract-opportunity-matching/`,
    required: ['Registered Federal Contractors Portal', 'APROPOS Group LLC', 'https://sam.gov/opportunities', '$79.00 one-time'],
  },
  {
    file: 'guides/how-to-find-government-contracts/index.html',
    url: `${ORIGIN}/guides/how-to-find-government-contracts/`,
    required: ['Registered Federal Contractors Portal', 'APROPOS Group LLC', 'https://sam.gov/opportunities', 'https://www.census.gov/naics/'],
  },
  {
    file: 'guides/naics-codes-government-contracts/index.html',
    url: `${ORIGIN}/guides/naics-codes-government-contracts/`,
    required: ['Registered Federal Contractors Portal', 'APROPOS Group LLC', 'https://www.census.gov/naics/', 'https://sam.gov/opportunities', 'https://www.sba.gov/size'],
  },
  {
    file: 'guides/sam-gov-registration-small-business/index.html',
    url: `${ORIGIN}/guides/sam-gov-registration-small-business/`,
    required: ['Registered Federal Contractors Portal', 'APROPOS Group LLC', 'https://sam.gov/entity-registration', 'https://sam.gov/opportunities'],
  },
  {
    file: 'guides/federal-small-business-set-asides/index.html',
    url: `${ORIGIN}/guides/federal-small-business-set-asides/`,
    required: ['Registered Federal Contractors Portal', 'APROPOS Group LLC', 'https://www.sba.gov/certifications/', 'https://sam.gov/opportunities'],
  },
];

function checkPage(page) {
  const target = path.join(ROOT, page.file);
  if (!fs.existsSync(target)) {
    failures.push(`${page.file}: file missing`);
    return;
  }
  const html = fs.readFileSync(target, 'utf8');
  const canonical = `<link rel="canonical" href="${page.url}">`;
  if (!html.includes(canonical)) failures.push(`${page.file}: canonical mismatch`);
  if (!/<meta name="robots" content="[^"]*index[^"]*follow/i.test(html)) failures.push(`${page.file}: index/follow robots directive missing`);
  if (!/<title>[^<]{20,}[^<]*<\/title>/i.test(html)) failures.push(`${page.file}: substantive title missing`);
  if (!/<meta name="description" content="[^\"]{80,}/i.test(html)) failures.push(`${page.file}: substantive meta description missing`);
  if (!/<h1>[^<]{20,}/i.test(html)) failures.push(`${page.file}: substantive H1 missing`);
  if (!html.includes('media="print" onload="this.media=\'all\'"')) failures.push(`${page.file}: nonblocking Google Fonts stylesheet missing`);
  if (!html.includes('<noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?')) failures.push(`${page.file}: Google Fonts noscript fallback missing`);
  if (!html.includes('/assets/federal-authority.css')) failures.push(`${page.file}: shared authority stylesheet missing`);
  if (/\$(?:15(?:\.00)?|49\.99)\b/.test(html)) failures.push(`${page.file}: obsolete Analyze Fit price found`);
  if (/https?:\/\/ngcc\.aproposgroupllc\.com/i.test(html)) failures.push(`${page.file}: retired public hostname found`);
  if (html.includes(legacyFullName)) failures.push(`${page.file}: former full product name found as primary content`);
  for (const token of page.required) if (!html.includes(token)) failures.push(`${page.file}: missing required token ${token}`);

  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)];
  if (!blocks.length) failures.push(`${page.file}: JSON-LD missing`);
  for (const block of blocks) {
    try { JSON.parse(block[1]); }
    catch (error) { failures.push(`${page.file}: invalid JSON-LD — ${error.message}`); }
  }
}

for (const page of pages) checkPage(page);

const sitemapPath = path.join(ROOT, 'sitemap.xml');
if (!fs.existsSync(sitemapPath)) failures.push('sitemap.xml missing');
else {
  const sitemap = fs.readFileSync(sitemapPath, 'utf8');
  for (const page of pages) {
    if (!sitemap.includes(`<loc>${page.url}</loc>`)) failures.push(`sitemap missing ${page.url}`);
  }
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  const duplicates = locs.filter((url, index) => locs.indexOf(url) !== index);
  if (duplicates.length) failures.push(`sitemap contains duplicate URLs: ${[...new Set(duplicates)].join(', ')}`);
}

const cssPath = path.join(ROOT, 'assets/federal-authority.css');
if (!fs.existsSync(cssPath) || fs.statSync(cssPath).size < 2000) failures.push('shared federal authority stylesheet missing or unexpectedly small');

if (failures.length) {
  console.error('[rfcp-wave1-authority] Validation failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`[rfcp-wave1-authority] PASS — ${pages.length} canonical federal authority destinations, sitemap entries, source links, identity, pricing and font-loading controls validated.`);
require('./apply-rfcp-wave2-authority.cjs');
require('./validate-rfcp-wave2-authority.cjs');

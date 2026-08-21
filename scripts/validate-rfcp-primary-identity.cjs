'use strict';

const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const robots = fs.readFileSync('robots.txt', 'utf8');
const sitemap = fs.readFileSync('sitemap.xml', 'utf8');

const primary = 'https://federalcontractorportal.aproposgroupllc.com/';
const aliasJson = '"alternateName":["National Government Contract Center","NGCC"]';

const failures = [];
if (!html.includes(`<link rel="canonical" href="${primary}">`)) failures.push('homepage canonical is not the primary portal domain');
if (!html.includes(aliasJson)) failures.push('NGCC/National Government Contract Center aliases are missing from structured data');
if (html.includes('"alternateName":"Registered Federal Contractors Portal"')) failures.push('primary name is incorrectly repeated as alternateName');
if (!robots.includes(`Sitemap: ${primary}sitemap.xml`)) failures.push('robots.txt sitemap is not on the primary portal domain');
if (!sitemap.includes(`<loc>${primary}</loc>`)) failures.push('sitemap root URL is not the primary portal domain');

if (failures.length) {
  console.error('[rfcp-primary-identity] Validation failed:');
  failures.forEach(f => console.error(`- ${f}`));
  process.exit(1);
}

console.log('[rfcp-primary-identity] PASS — primary domain and NGCC aliases are consistent.');

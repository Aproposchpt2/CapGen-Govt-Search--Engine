'use strict';

const fs = require('fs');

const file = 'index.html';
let html = fs.readFileSync(file, 'utf8');
const fontTagPattern = /<link\b(?=[^>]*href=["']https:\/\/fonts\.googleapis\.com\/css2\?)[^>]*>/i;
const match = html.match(fontTagPattern);
if (!match) throw new Error('Phase 2B font remediation: homepage Google Fonts stylesheet not found.');

const hrefMatch = match[0].match(/href=["']([^"']+)["']/i);
if (!hrefMatch) throw new Error('Phase 2B font remediation: Google Fonts href not found.');
const href = hrefMatch[1];
const asyncTag = `<link rel="stylesheet" href="${href}" media="print" onload="this.media='all'">`;
const fallback = `<noscript><link rel="stylesheet" href="${href}"></noscript>`;

if (!match[0].includes('media="print"')) {
  html = html.replace(match[0], `${asyncTag}\n  ${fallback}`);
} else if (!html.includes(fallback)) {
  html = html.replace(match[0], `${match[0]}\n  ${fallback}`);
}

if ((html.match(/fonts\.googleapis\.com\/css2\?/g) || []).length < 2) {
  throw new Error('Phase 2B font remediation: async stylesheet and noscript fallback are both required.');
}
if (!html.includes(asyncTag) || !html.includes(fallback)) {
  throw new Error('Phase 2B font remediation: non-render-blocking font contract not satisfied.');
}

fs.writeFileSync(file, html, 'utf8');
const published = fs.readFileSync(file, 'utf8');
if (!published.includes(asyncTag) || !published.includes(fallback)) {
  throw new Error('Phase 2B font remediation: publish artifact verification failed.');
}
console.log('[phase2b-fonts] PASS — homepage fonts retain the same Google families with non-render-blocking CSS and noscript fallback.');

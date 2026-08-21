'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const file = path.join(root, 'index.html');
const PRIMARY = 'https://federalcontractorportal.aproposgroupllc.com/';
const PRIMARY_ORIGIN = PRIMARY.slice(0, -1);
const ORG_ID = `${PRIMARY}#organization`;
const WEBSITE_ID = `${PRIMARY}#website`;
const SERVICE_ID = `${PRIMARY}#service`;
const FAQ_ID = `${PRIMARY}#faq`;

// Final deploy-artifact sanitation. Historical source scripts and compatibility
// modules may still use older technical namespaces, but no generated text file
// or bundled function should emit the retired public hostname or former full
// product name. Runtime function/table/environment identifiers are left intact.
const legacyHostPattern = /https?:\/\/ngcc\.aproposgroupllc\.com/gi;
const legacyFullName = ['National', 'Government', 'Contract', 'Center'].join(' ');
const textExtensions = new Set(['.html', '.js', '.mjs', '.cjs', '.json', '.toml', '.md', '.yml', '.yaml', '.txt', '.xml']);
function sanitizeTree(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      sanitizeTree(target);
      continue;
    }
    if (!entry.isFile() || !textExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    let source;
    try { source = fs.readFileSync(target, 'utf8'); } catch { continue; }
    const remediated = source
      .replace(legacyHostPattern, PRIMARY_ORIGIN)
      .split(legacyFullName).join('Registered Federal Contractors Portal');
    if (remediated !== source) fs.writeFileSync(target, remediated, 'utf8');
  }
}
sanitizeTree(root);

let html = fs.readFileSync(file, 'utf8');

function replaceRequired(pattern, replacement, label) {
  if (!pattern.test(html)) throw new Error(`[rfcp-primary-identity] required marker not found: ${label}`);
  html = html.replace(pattern, replacement);
}

function textOnly(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Canonical and social graph signals always resolve to the primary hostname.
replaceRequired(/<link rel="canonical" href="[^"]+">/i, `<link rel="canonical" href="${PRIMARY}">`, 'canonical');
replaceRequired(/<meta property="og:url" content="[^"]+">/i, `<meta property="og:url" content="${PRIMARY}">`, 'Open Graph URL');
replaceRequired(/<meta property="og:image" content="[^"]+">/i, `<meta property="og:image" content="${PRIMARY}og-ngcc.jpg">`, 'Open Graph image');
replaceRequired(/<meta name="twitter:image" content="[^"]+">/i, `<meta name="twitter:image" content="${PRIMARY}og-ngcc.jpg">`, 'Twitter image');

// Public header identity: product name + descriptive procurement category only.
html = html.replace(/(<div class="lname">Registered Federal Contractors Portal<\/div>)<div class="lsub">[^<]*<\/div>/i, '$1<div class="lsub">Federal Procurement Intelligence</div>');

// Preserve the current Service semantics/pricing produced by earlier build
// steps, while rebuilding the authoritative Organization, WebSite and FAQ graph.
const ldPattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/i;
const ldMatch = html.match(ldPattern);
if (!ldMatch) throw new Error('[rfcp-primary-identity] homepage JSON-LD graph not found.');
let prior;
try {
  prior = JSON.parse(ldMatch[1]);
} catch (error) {
  throw new Error(`[rfcp-primary-identity] homepage JSON-LD is invalid: ${error.message}`);
}
const priorGraph = Array.isArray(prior?.['@graph']) ? prior['@graph'] : [];
const service = priorGraph.find(node => node?.['@type'] === 'Service') || {
  '@type': 'Service',
  name: 'Federal Contract Matching for Registered Contractors',
  serviceType: 'Personalized federal procurement opportunity matching',
  areaServed: { '@type': 'Country', name: 'United States' },
};
service['@id'] = SERVICE_ID;
service.url = PRIMARY;
service.provider = { '@id': ORG_ID };
if (service.offers && !Array.isArray(service.offers)) service.offers.url = PRIMARY;
if (Array.isArray(service.offers)) service.offers.forEach(offer => { if (offer && typeof offer === 'object') offer.url = PRIMARY; });

const faqByQuestion = new Map();
const faqPattern = /<div class="faq-item"><h3>([\s\S]*?)<\/h3><p>([\s\S]*?)<\/p><\/div>/gi;
for (const match of html.matchAll(faqPattern)) faqByQuestion.set(textOnly(match[1]), textOnly(match[2]));
const faqQuestions = [
  'Who does the Registered Federal Contractors Portal serve?',
  'What does the Registered Federal Contractors Portal cost?',
  'What does an additional Analyze Fit Report cost?',
  'Is the Registered Federal Contractors Portal a government agency or part of SAM.gov?',
];
const mainEntity = faqQuestions.map(name => {
  const answer = faqByQuestion.get(name);
  if (!answer) throw new Error(`[rfcp-primary-identity] FAQ answer not found for: ${name}`);
  return { '@type': 'Question', name, acceptedAnswer: { '@type': 'Answer', text: answer } };
});

const graph = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': ORG_ID,
      name: 'Registered Federal Contractors Portal',
      url: PRIMARY,
      parentOrganization: {
        '@type': 'Corporation',
        name: 'APROPOS Group LLC',
        url: 'https://aproposgroupllc.com/',
      },
      sameAs: [
        'https://aproposgroupllc.com/',
        'https://natcorp.aproposgroupllc.com/',
        'https://nebc.aproposgroupllc.com/',
        'https://marketplace.aproposgroupllc.com/',
        'https://github.com/Aproposchpt2',
      ],
      contactPoint: {
        '@type': 'ContactPoint',
        contactType: 'Customer Support',
        email: 'jmitchell@aiflowdeskpro.com',
      },
    },
    {
      '@type': 'WebSite',
      '@id': WEBSITE_ID,
      url: PRIMARY,
      name: 'Registered Federal Contractors Portal',
      publisher: { '@id': ORG_ID },
      inLanguage: 'en-US',
    },
    service,
    {
      '@type': 'FAQPage',
      '@id': FAQ_ID,
      mainEntity,
    },
  ],
};
html = html.replace(ldPattern, `<script type="application/ld+json">${JSON.stringify(graph)}</script>`);

// Entity-network links provide explicit crawlable relationships between the
// portal, its parent company, and the related APROPOS properties.
const entityLinks = '<div class="entity-links" aria-label="APROPOS Group LLC network"><a href="https://aproposgroupllc.com/">APROPOS Group LLC</a><span aria-hidden="true"> · </span><a href="https://nebc.aproposgroupllc.com/">National Enterprise Business Center</a><span aria-hidden="true"> · </span><a href="https://natcorp.aproposgroupllc.com/">National Corporate Contract Exchange</a><span aria-hidden="true"> · </span><a href="https://marketplace.aproposgroupllc.com/">APROPOS Marketing Marketplace</a></div>';
if (!html.includes('class="entity-links"')) {
  html = html.replace(
    '<div class="foot">Registered Federal Contractors Portal · Operated by APROPOS Group LLC</div>',
    `<div class="foot">Registered Federal Contractors Portal · Operated by APROPOS Group LLC</div>${entityLinks}`,
  );
}
if (!html.includes('.entity-links{')) {
  html = html.replace(
    '.disc{margin-top:.7rem;font-size:.68rem;color:rgba(255,255,255,.6)}',
    '.entity-links{margin-top:.65rem;display:flex;justify-content:center;gap:.45rem;flex-wrap:wrap;font-size:.72rem;color:rgba(255,255,255,.76)}.entity-links a{text-decoration:underline;text-underline-offset:3px}.disc{margin-top:.7rem;font-size:.68rem;color:rgba(255,255,255,.6)}',
  );
}

// Phase 2B performance contract: preserve high-priority hero discovery and
// the already-approved non-render-blocking Google Fonts transformation.
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
console.log('[rfcp-primary-identity] Applied primary portal identity, schema graph, FAQ entities, network links, deploy hostname sanitation, and hero preload.');
require('./apply-nonblocking-fonts.cjs');
